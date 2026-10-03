// The hard rules. The model proposes; this file decides.
// Confidence threshold, quiet mode, rate limits, and "credit never names the restater"
// are enforced here, so prompt changes can't break them (see tests/).
import type { Brain, BrainInput, BrainOutput } from "./brain.ts";
import { similarity } from "./brain.ts";
import type { Rules } from "./config.ts";
import { type Chat, type Item, nameOf, type Store } from "./store.ts";

export interface Incoming {
  spaceKey: string; // platform space id
  senderKey: string; // platform sender id (phone/email) - never leaves this process
  senderName?: string; // known display name (terminal "Priya: ..." prefix)
  text: string;
  isGroup?: boolean;
  ref?: unknown; // platform message handle, used for tapbacks / threaded replies
}

export interface Outbox {
  react(spaceKey: string, ref: unknown, emoji: string): Promise<void>;
  send(spaceKey: string, text: string, replyTo?: unknown): Promise<void>;
  sendVoice?(spaceKey: string, audio: Buffer, replyTo?: unknown): Promise<void>;
}

/** Something happened to an item (for growth history in Tiger Data). */
export interface KeeperEvent {
  treeId: string; // the tree code (unique, never reused)
  itemId: string;
  kind: Item["kind"];
  event: "created" | "done" | "dropped" | "reopened" | "credited";
  at: number;
}

export interface KeeperDeps {
  store: Store;
  brain: Brain;
  outbox: Outbox;
  rules: Rules;
  now?: () => number;
  tts?: (text: string) => Promise<Buffer | undefined>;
  log?: (msg: string) => void;
  onEvent?: (e: KeeperEvent) => void;
  publicUrl?: string; // where the tree page lives, for "keeper code"
}

interface Pending {
  lines: { alias: string; text: string; ref?: unknown }[];
  question?: { alias: string; text: string; ref?: unknown };
  timer?: ReturnType<typeof setTimeout>;
}

const LIKE = "👍";
const PHONE_RE = /\+?\d[\d\s().-]{6,}\d/g;

export const HELP = [
  "I'm Keeper 🌱 I stay quiet and remember who committed to what, what we decided, and whose idea it was.",
  "keeper list · keeper done 3 · keeper recap (or recap voice) · keeper code (see your tree) · keeper name <tree name> · keeper call me <name> · keeper quiet 30m · keeper unquiet · keeper forget everything",
  "Text me 1:1: keeper me (your stats) · keeper grove (all your trees)",
  "Or just ask: keeper what's still open?",
].join("\n");

export class Keeper {
  private pending = new Map<string, Pending>();
  private now: () => number;
  private log: (m: string) => void;

  constructor(private d: KeeperDeps) {
    this.now = d.now ?? Date.now;
    this.log = d.log ?? (() => {});
  }

  // ---------------------------------------------------------------- inbound
  async receive(m: Incoming): Promise<void> {
    const { store } = this.d;
    const chat = store.chat(m.spaceKey);
    const person = store.person(chat, m.senderKey);
    if (m.senderName && !person.name) person.name = m.senderName;
    if (m.isGroup !== undefined) chat.isDm = !m.isGroup;
    const text = m.text.trim();
    if (!text) return;

    const cmd = text.match(/^@?keeper\b[\s,:!-]*(.*)$/is);
    if (cmd) {
      const handled = await this.command(chat, m, cmd[1]!.trim());
      store.save();
      if (handled) return;
      // free-form question -> one model call, answered in-thread
      const p = this.pendingFor(m.spaceKey);
      p.question = { alias: person.alias, text: cmd[1]!.trim(), ref: m.ref };
      await this.flush(m.spaceKey);
      return;
    }

    person.messages++;
    person.words += text.split(/\s+/).length;
    store.addLine(chat, { alias: person.alias, text, ts: this.now() });
    const p = this.pendingFor(m.spaceKey);
    p.lines.push({ alias: person.alias, text, ref: m.ref });
    if (p.timer) clearTimeout(p.timer);
    if (this.d.rules.burstMs > 0) {
      p.timer = setTimeout(() => void this.flush(m.spaceKey).catch((e) => this.log(`flush failed: ${e}`)), this.d.rules.burstMs);
      p.timer.unref?.();
    }
    store.save();
  }

  /** Process everything waiting for every chat (tests / sim / shutdown). */
  async flushAll() {
    for (const k of [...this.pending.keys()]) await this.flush(k);
  }

  async flush(spaceKey: string): Promise<BrainOutput | undefined> {
    const p = this.pending.get(spaceKey);
    if (!p || (!p.lines.length && !p.question)) return;
    if (p.timer) clearTimeout(p.timer);
    this.pending.delete(spaceKey);

    const chat = this.d.store.chat(spaceKey);
    const burstTexts = new Set(p.lines.map((l) => l.text));
    const input: BrainInput = {
      people: Object.values(chat.people).map((x) => ({ alias: x.alias, name: x.name })),
      memory: chat.items
        .filter((i) => i.status === "open" || this.now() - i.updatedAt < 86_400_000)
        .map((i) => ({ id: i.id, kind: i.kind, status: i.status, text: i.text, from: i.from, owner: i.owner })),
      context: chat.recent.filter((l) => !burstTexts.has(l.text)).slice(-15),
      burst: p.lines.map((l, i) => ({ n: i + 1, alias: l.alias, text: l.text })),
      question: p.question ? { alias: p.question.alias, text: p.question.text } : undefined,
    };
    const out = await this.d.brain.think(input);
    await this.apply(spaceKey, chat, p, out);
    this.d.store.save();
    return out;
  }

  private emit(chat: Chat, item: Item, event: KeeperEvent["event"]) {
    try {
      this.d.onEvent?.({ treeId: chat.code, itemId: item.id, kind: item.kind, event, at: this.now() });
    } catch {
      // history is best-effort; never break the chat over it
    }
  }

  private pendingFor(spaceKey: string): Pending {
    let p = this.pending.get(spaceKey);
    if (!p) this.pending.set(spaceKey, (p = { lines: [] }));
    return p;
  }

  // ---------------------------------------------------------------- rules
  private async apply(spaceKey: string, chat: Chat, p: Pending, out: BrainOutput) {
    const { rules, outbox, store } = this.d;
    const now = this.now();
    const aliases = new Set(Object.values(chat.people).map((x) => x.alias));
    const inBurst = new Set(p.lines.map((l) => l.alias));
    const toLike = new Set<number>();

    for (const it of out.items) {
      if (it.confidence < rules.minConfidence) continue;
      if (!aliases.has(it.from) || !inBurst.has(it.from)) continue;
      // A commitment only counts if the speaker made it about themselves.
      if (it.kind === "commitment" && it.owner && it.owner !== it.from) continue;
      const owner = it.kind === "commitment" ? it.from : undefined;
      const dup = chat.items.some((x) => x.status === "open" && x.kind === it.kind && similarity(x.text, it.text) >= 0.8);
      if (dup) continue;
      const item = store.addItem(chat, { kind: it.kind, text: scrub(it.text), from: it.from, owner, due: it.due, source: "chat" }, now);
      this.log(`${chat.id} + ${item.kind} ${item.id} "${item.text}" from ${item.from}`);
      this.emit(chat, item, "created");
      toLike.add(it.msg ?? p.lines.length);
    }

    for (const u of out.updates) {
      if (u.confidence < rules.minConfidence) continue;
      const item = chat.items.find((x) => x.id === u.itemId && x.status === "open");
      if (!item) continue;
      item.status = u.status;
      item.updatedAt = now;
      this.log(`${chat.id} ~ ${item.id} -> ${u.status}`);
      this.emit(chat, item, u.status);
      toLike.add(p.lines.length);
    }

    for (const c of out.credits) {
      if (c.confidence < rules.minConfidence) continue;
      const item = chat.items.find((x) => x.id === c.itemId);
      if (!item || item.kind !== "idea" || item.credited) continue;
      if (item.from === c.restatedBy || !inBurst.has(c.restatedBy)) continue;
      if (!this.gate(chat)) continue;
      const restater = nameOf(chat, c.restatedBy);
      const msg = creditMessage(nameOf(chat, item.from), item.text, [restater, c.restatedBy]);
      item.credited = true;
      item.updatedAt = now;
      await outbox.send(spaceKey, msg);
      this.log(`${chat.id} credit ${item.id} -> ${item.from}`);
      this.emit(chat, item, "credited");
    }

    // Silent acknowledgement: one tapback per message that produced memory.
    for (const n of toLike) {
      const ref = p.lines[n - 1]?.ref;
      if (ref !== undefined && !this.isQuiet(chat)) await outbox.react(spaceKey, ref, LIKE).catch(() => {});
    }

    if (p.question) {
      const reply = scrub(out.reply ?? listOpen(chat));
      await outbox.send(spaceKey, reply, p.question.ref);
    }
  }

  isQuiet(chat: Chat) {
    return !!chat.quietUntil && chat.quietUntil > this.now();
  }

  /** May Keeper speak without being asked? Enforces quiet mode, daily cap and cooldown. */
  gate(chat: Chat): boolean {
    const now = this.now();
    if (this.isQuiet(chat)) return false;
    chat.unprompted = chat.unprompted.filter((t) => now - t < 86_400_000);
    if (chat.unprompted.length >= this.d.rules.unpromptedDailyMax) return false;
    const last = chat.unprompted.at(-1);
    if (last !== undefined && now - last < this.d.rules.unpromptedCooldownMs) return false;
    chat.unprompted.push(now);
    return true;
  }

  /** Periodic: gently resurface one forgotten idea per chat. */
  async tick() {
    const now = this.now();
    for (const [spaceKey, chat] of Object.entries(this.d.store.state.chats)) {
      const stale = chat.items.find(
        (i) => i.status === "open" && i.kind === "idea" && !i.resurfaced && !i.credited && now - i.createdAt >= this.d.rules.resurfaceAfterMs,
      );
      if (!stale || !this.gate(chat)) continue;
      stale.resurfaced = true;
      await this.d.outbox.send(spaceKey, `Still open from earlier: ${nameOf(chat, stale.from)}'s idea, "${stale.text}". Anyone want to pick it up?`);
      this.d.store.save();
    }
  }

  // ---------------------------------------------------------------- commands (never call the model)
  private async command(chat: Chat, m: Incoming, rest: string): Promise<boolean> {
    const { outbox, store } = this.d;
    const say = (t: string) => outbox.send(m.spaceKey, t, m.ref);
    const me = store.person(chat, m.senderKey);
    const low = rest.toLowerCase().replace(/[?!.]+$/, "");
    let r: RegExpMatchArray | null;

    if (low === "" || low === "help") return void (await say(HELP)), true;
    if (/^(list|open|todo|what'?s (still )?open|what is (still )?open)$/.test(low)) return void (await say(listOpen(chat))), true;
    if ((r = low.match(/^(done|drop|undo)\s+#?i?(\d+)$/))) {
      const item = chat.items.find((x) => x.id === `i${r![2]}`);
      if (!item) return void (await say(`I don't have #${r[2]}.`)), true;
      item.status = r[1] === "done" ? "done" : r[1] === "drop" ? "dropped" : "open";
      item.updatedAt = this.now();
      this.emit(chat, item, item.status === "open" ? "reopened" : item.status);
      await outbox.react(m.spaceKey, m.ref, LIKE).catch(() => {});
      return true;
    }
    if ((r = low.match(/^(?:be )?quiet(?:\s+(?:for\s+)?(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)?)?$/))) {
      const n = Number(r[1] ?? 60);
      const ms = r[2]?.startsWith("h") ? n * 3_600_000 : n * 60_000;
      chat.quietUntil = this.now() + ms;
      await say(`Okay, quiet for ${r[2]?.startsWith("h") ? `${n}h` : `${n}m`}. I'll still remember things. 🤫`);
      return true;
    }
    if (/^(unquiet|wake up|you can talk|back)$/.test(low)) {
      chat.quietUntil = undefined;
      await say("I'm back 🌱");
      return true;
    }
    if (/^forget everything$/.test(low)) {
      store.forget(m.spaceKey);
      await say("Done. I've forgotten everything from this chat.");
      return true;
    }
    if ((r = rest.match(/^call me\s+(.{1,30})$/i))) {
      me.name = r[1]!.replace(/[^\p{L}\p{N} .'-]/gu, "").trim() || me.name;
      await outbox.react(m.spaceKey, m.ref, LIKE).catch(() => {});
      return true;
    }
    if ((r = rest.match(/^name (?:our tree |this tree |the tree |this chat )?(.{1,40})$/i))) {
      chat.title = r[1]!.replace(/[^\p{L}\p{N}\p{Emoji} .,'&!-]/gu, "").trim() || chat.title;
      await outbox.react(m.spaceKey, m.ref, LIKE).catch(() => {});
      return true;
    }
    if (/^(code|tree|link|our tree|website|site)$/.test(low)) {
      const url = this.d.publicUrl ? `\n${this.d.publicUrl}/?code=${chat.code}` : "";
      await say(`Your tree code is ${chat.code} 🌳 Anyone in this chat can open it:${url}`);
      return true;
    }
    if (/^(grove|my grove|my code|my trees|forest)$/.test(low)) {
      if (m.isGroup) {
        await say("Your grove shows every chat you're in, so it's private. Text me 1:1 \"keeper grove\" and I'll send your code there.");
        return true;
      }
      const code = store.groveCode(m.senderKey);
      const url = this.d.publicUrl ? `\n${this.d.publicUrl}/?code=${code}` : "";
      await say(`Your personal grove code is ${code} ✨ It shows every tree you're part of. Keep it to yourself.${url}`);
      return true;
    }
    if (/^(me|my stuff|stats|mine)$/.test(low)) {
      if (m.isGroup) {
        await say("Your stats are just for you. Text me 1:1 \"keeper me\" and I'll tell you there.");
        return true;
      }
      // DM: we can only see this person's stats in chats they share with this line.
      await say(personalSummary(store.state.chats, m.senderKey));
      return true;
    }
    if ((r = low.match(/^recap(\s+voice)?$/))) {
      const text = recap(chat);
      if (r[1] && this.d.tts && outbox.sendVoice) {
        const audio = await this.d.tts(text).catch(() => undefined);
        if (audio) return void (await outbox.sendVoice(m.spaceKey, audio, m.ref)), true;
      }
      await say(text);
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------- helpers
/** Remove anything that looks like a phone number. */
export function scrub(s: string): string {
  return s.replace(PHONE_RE, "[number]");
}

/** Credit the original author. The restater is never named, even if the model's text mentions them. */
export function creditMessage(original: string, text: string, neverMention: string[]): string {
  let t = text;
  for (const n of neverMention) if (n) t = t.replace(new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "").replace(/\s{2,}/g, " ").trim();
  return scrub(`Love this. That builds on ${original}'s idea from earlier 🌱 ("${t}")`);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function listOpen(chat: Chat): string {
  const open = chat.items.filter((i) => i.status === "open");
  if (!open.length) return "Nothing open right now 🌱";
  const line = (i: Item) => {
    const who = i.kind === "commitment" ? ` (${nameOf(chat, i.owner)}${i.due ? `, ${i.due}` : ""})` : i.kind === "idea" ? ` (${nameOf(chat, i.from)}'s idea)` : "";
    return `#${i.id.slice(1)} ${i.text}${who}`;
  };
  const sec = (k: Item["kind"], title: string) => {
    const xs = open.filter((i) => i.kind === k);
    return xs.length ? `${title}\n${xs.map(line).join("\n")}` : "";
  };
  return [sec("commitment", "To do:"), sec("decision", "Decided:"), sec("idea", "Ideas:")].filter(Boolean).join("\n\n");
}

export function recap(chat: Chat): string {
  const open = chat.items.filter((i) => i.status === "open");
  const done = chat.items.filter((i) => i.status === "done");
  const c = open.filter((i) => i.kind === "commitment");
  const d = chat.items.filter((i) => i.kind === "decision" && i.status !== "dropped");
  const ideas = open.filter((i) => i.kind === "idea");
  const parts = [`Here's where things stand.`];
  if (d.length) parts.push(`You decided: ${d.map((i) => i.text).join("; ")}.`);
  if (c.length) parts.push(`Still to do: ${c.map((i) => `${nameOf(chat, i.owner)} will ${i.text}${i.due ? ` by ${i.due}` : ""}`).join("; ")}.`);
  if (ideas.length) parts.push(`Ideas on the table: ${ideas.map((i) => `${nameOf(chat, i.from)}'s idea to ${i.text}`).join("; ")}.`);
  if (done.length) parts.push(`${done.length} thing${done.length === 1 ? "" : "s"} already done. Nice work.`);
  if (parts.length === 1) parts.push("Nothing recorded yet.");
  return parts.join(" ");
}

function personalSummary(chats: Record<string, Chat>, senderKey: string): string {
  const lines: string[] = [];
  for (const chat of Object.values(chats)) {
    const p = chat.people[senderKey];
    if (!p) continue;
    const total = Object.values(chat.people).reduce((s, x) => s + x.words, 0) || 1;
    const mine = chat.items.filter((i) => i.status === "open" && i.owner === p.alias);
    const ideas = chat.items.filter((i) => i.kind === "idea" && i.from === p.alias).length;
    lines.push(
      `${chat.title ?? chat.id}: you wrote ${Math.round((100 * p.words) / total)}% of the words, shared ${ideas} idea${ideas === 1 ? "" : "s"}` +
        (mine.length ? `, and you're on: ${mine.map((i) => i.text).join("; ")}` : ""),
    );
  }
  return lines.length ? `Just for you:\n${lines.join("\n")}` : "I don't have anything about you yet.";
}
