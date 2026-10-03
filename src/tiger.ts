// Tiger Data (TimescaleDB on Postgres): the grove's growth history.
// Every item event (planted, done, credited...) is a row in a hypertable; a continuous
// aggregate rolls them into 15-minute buckets so the "growth rings" chart is instant.
// Optional: without TIGER_DATABASE_URL, growth is computed from data/state.json instead.
import pg from "pg";
import type { KeeperEvent } from "./keeper.ts";
import type { Chat, Store } from "./store.ts";

export interface GrowthPoint {
  t: number; // bucket start (ms)
  planted: number; // cumulative items created
  bloomed: number; // cumulative items done
  credited: number; // cumulative ideas credited back
}
export interface Growth {
  source: "tiger" | "memory";
  points: GrowthPoint[];
}

const BUCKET_MS = 15 * 60_000;

export class Tiger {
  timescale = false;
  private inflight = new Set<Promise<unknown>>();
  private constructor(private pool: pg.Pool) {}

  static async connect(url: string, log = console.log): Promise<Tiger | undefined> {
    log("[tiger] connecting…");
    // We set SSL ourselves, so drop "sslmode" from the URL (pg prints a confusing warning about it).
    const u = new URL(url);
    u.searchParams.delete("sslmode");
    const pool = new pg.Pool({
      connectionString: u.toString(),
      max: 3,
      connectionTimeoutMillis: 10_000, // never hang startup on a blocked network
      ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false },
    });
    pool.on("error", (e) => log(`[tiger] pool error: ${e.message}`));
    const t = new Tiger(pool);
    try {
      await t.init();
      log(`[tiger] connected (${t.timescale ? "TimescaleDB hypertable + continuous aggregate" : "plain Postgres fallback"})`);
      return t;
    } catch (e) {
      const msg = (e as Error).message;
      log(`[tiger] disabled: ${msg}`);
      if (/timeout|ETIMEDOUT|ECONNREFUSED|ENOTFOUND/i.test(msg)) {
        log("[tiger] tip: some Wi-Fi (campus, hackathon) blocks database ports. Try a phone hotspot, or check the service is running in the Tiger console.");
      }
      log("[tiger] continuing without it: growth rings are computed from memory.");
      await pool.end().catch(() => {});
      return undefined;
    }
  }

  private async init() {
    const q = (sql: string) => this.pool.query(sql);
    await q(`CREATE TABLE IF NOT EXISTS keeper_events (
      time    TIMESTAMPTZ NOT NULL,
      tree_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      kind    TEXT NOT NULL,
      event   TEXT NOT NULL)`);
    await q(`CREATE INDEX IF NOT EXISTS keeper_events_tree_time ON keeper_events (tree_id, time DESC)`);
    try {
      await q(`CREATE EXTENSION IF NOT EXISTS timescaledb`);
      await q(`SELECT create_hypertable('keeper_events', by_range('time', INTERVAL '1 day'), if_not_exists => TRUE, migrate_data => TRUE)`);
      await q(`CREATE MATERIALIZED VIEW IF NOT EXISTS keeper_growth_15m
        WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
        SELECT time_bucket(INTERVAL '15 minutes', time) AS bucket, tree_id, event, count(*) AS n
        FROM keeper_events GROUP BY bucket, tree_id, event WITH NO DATA`);
      await q(`SELECT add_continuous_aggregate_policy('keeper_growth_15m',
        start_offset => INTERVAL '30 days', end_offset => INTERVAL '15 minutes',
        schedule_interval => INTERVAL '15 minutes', if_not_exists => TRUE)`);
      this.timescale = true;
    } catch {
      this.timescale = false; // plain Postgres: same table, queried directly
    }
    if (this.timescale) {
      // old history compresses ~90%: keeps a whole weekend of groves on the free tier
      await q(`ALTER TABLE keeper_events SET (timescaledb.compress, timescaledb.compress_segmentby = 'tree_id')`).catch(() => {});
      await q(`SELECT add_compression_policy('keeper_events', INTERVAL '7 days', if_not_exists => TRUE)`).catch(() => {});
    }
  }

  /** Fire-and-forget insert. */
  record(e: KeeperEvent) {
    const p = this.pool
      .query(`INSERT INTO keeper_events (time, tree_id, item_id, kind, event) VALUES (to_timestamp($1 / 1000.0), $2, $3, $4, $5)`, [
        e.at,
        e.treeId,
        e.itemId,
        e.kind,
        e.event,
      ])
      .catch((err) => console.error("[tiger] insert failed:", err.message))
      .finally(() => this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** First run against an empty database: copy existing memory in, so history isn't blank. */
  async backfill(store: Store) {
    const { rows } = await this.pool.query<{ n: string }>(`SELECT count(*) AS n FROM keeper_events`);
    if (Number(rows[0]?.n) > 0) return;
    for (const chat of Object.values(store.state.chats)) {
      for (const it of chat.items) {
        this.record({ treeId: chat.code, itemId: it.id, kind: it.kind, event: "created", at: it.createdAt });
        if (it.status !== "open") this.record({ treeId: chat.code, itemId: it.id, kind: it.kind, event: it.status, at: it.updatedAt });
        if (it.credited) this.record({ treeId: chat.code, itemId: it.id, kind: it.kind, event: "credited", at: it.updatedAt });
      }
    }
  }

  async growth(treeId: string): Promise<Growth> {
    const sql = this.timescale
      ? `SELECT bucket, event, n FROM keeper_growth_15m WHERE tree_id = $1 ORDER BY bucket`
      : `SELECT date_bin(INTERVAL '15 minutes', time, TIMESTAMPTZ '2000-01-01') AS bucket, event, count(*) AS n
         FROM keeper_events WHERE tree_id = $1 GROUP BY 1, 2 ORDER BY 1`;
    const { rows } = await this.pool.query<{ bucket: Date; event: string; n: string }>(sql, [treeId]);
    return { source: "tiger", points: cumulative(rows.map((r) => ({ t: new Date(r.bucket).getTime(), event: r.event, n: Number(r.n) }))) };
  }

  async close() {
    await Promise.allSettled([...this.inflight]);
    await this.pool.end();
  }
}

/** Same chart without a database, from the items' timestamps. */
export function growthFromMemory(chat: Chat): Growth {
  const rows: { t: number; event: string; n: number }[] = [];
  for (const it of chat.items) {
    rows.push({ t: bucket(it.createdAt), event: "created", n: 1 });
    if (it.status === "done") rows.push({ t: bucket(it.updatedAt), event: "done", n: 1 });
    if (it.credited) rows.push({ t: bucket(it.updatedAt), event: "credited", n: 1 });
  }
  rows.sort((a, b) => a.t - b.t);
  return { source: "memory", points: cumulative(rows) };
}

const bucket = (ms: number) => Math.floor(ms / BUCKET_MS) * BUCKET_MS;

function cumulative(rows: { t: number; event: string; n: number }[]): GrowthPoint[] {
  const out: GrowthPoint[] = [];
  let planted = 0, bloomed = 0, credited = 0;
  for (const r of rows) {
    if (r.event === "created") planted += r.n;
    else if (r.event === "done") bloomed += r.n;
    else if (r.event === "reopened") bloomed = Math.max(0, bloomed - r.n);
    else if (r.event === "credited") credited += r.n;
    const last = out.at(-1);
    if (last && last.t === r.t) Object.assign(last, { planted, bloomed, credited });
    else out.push({ t: r.t, planted, bloomed, credited });
  }
  return out;
}
