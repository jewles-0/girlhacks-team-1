// One structured model call per burst of messages, with defensive parsing.
// Works with Azure OpenAI, plain OpenAI, or an offline rule-based mock.
import OpenAI, { AzureOpenAI } from "openai";
import { config } from "./config.ts";
import { SYSTEM_PROMPT, userPrompt } from "./prompts.ts";
import type { ItemKind } from "./store.ts";

export interface BrainInput {
  people: { alias: string; name?: string }[];
  memory: { id: string; kind: ItemKind; status: string; text: string; from: string; owner?: string }[];
  context: { alias: string; text: string }[];
  burst: { n: number; alias: string; text: string }[];
  question?: { alias: string; text: string };
}

export interface ProposedItem {
  kind: ItemKind;
  text: string;
  from: string;
  owner?: string;
  due?: string;
  msg?: number;
  confidence: number;
}
export interface ProposedUpdate {
  itemId: string;
  status: "done" | "dropped";
  confidence: number;
}
export interface ProposedCredit {
  itemId: string;
  restatedBy: string;
  msg?: number;
  confidence: number;
}
export interface BrainOutput {
  items: ProposedItem[];
  updates: ProposedUpdate[];
  credits: ProposedCredit[];
  reply?: string;
}

export interface Brain {
  name: string;
  think(input: BrainInput): Promise<BrainOutput>;
}

const KINDS = new Set(["commitment", "decision", "idea"]);
const str = (v: unknown) => (typeof v === "string" && v.trim() && v.trim() !== "null" ? v.trim() : undefined);
const conf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : undefined);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];

/** Turn whatever the model returned into a safe BrainOutput. Never throws. */
export function parseBrainOutput(raw: unknown): BrainOutput {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    const m = raw.match(/\{[\s\S]*\}/);
    try {
      obj = m ? JSON.parse(m[0]) : {};
    } catch {
      obj = {};
    }
  }
  const o = (obj && typeof obj === "object" ? obj : {}) as Record<string, unknown>;
  const items: ProposedItem[] = [];
  for (const it of arr(o.items)) {
    const kind = str(it.kind);
    const text = str(it.text);
    const from = str(it.from);
    if (!kind || !KINDS.has(kind) || !text || !from) continue;
    items.push({
      kind: kind as ItemKind,
      text: text.slice(0, 140),
      from,
      owner: str(it.owner),
      due: str(it.due),
      msg: int(it.msg),
      confidence: conf(it.confidence),
    });
  }
  const updates: ProposedUpdate[] = [];
  for (const u of arr(o.updates)) {
    const itemId = str(u.itemId);
    const status = str(u.status);
    if (!itemId || (status !== "done" && status !== "dropped")) continue;
    updates.push({ itemId, status, confidence: conf(u.confidence) });
  }
  const credits: ProposedCredit[] = [];
  for (const c of arr(o.credits)) {
    const itemId = str(c.itemId);
    const restatedBy = str(c.restatedBy);
    if (!itemId || !restatedBy) continue;
    credits.push({ itemId, restatedBy, msg: int(c.msg), confidence: conf(c.confidence) });
  }
  return { items, updates, credits, reply: str(o.reply)?.slice(0, 400) };
}

class LLMBrain implements Brain {
  constructor(
    public name: string,
    private client: OpenAI,
    private model: string,
  ) {}
  async think(input: BrainInput): Promise<BrainOutput> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt(input) },
        ],
      });
      return parseBrainOutput(res.choices[0]?.message?.content ?? "");
    } catch (err) {
      console.error(`[brain] ${this.name} call failed:`, (err as Error).message);
      return { items: [], updates: [], credits: [] };
    }
  }
}

// ---------------------------------------------------------------------------
// Mock brain: free, offline, deterministic. Good enough for the terminal demo
// and tests; the real model is much better at sarcasm and nuance.
// ---------------------------------------------------------------------------
const STOP = new Set(
  "a an the we i you it to of for and or but so if what how about maybe should could would just do our us let's lets be is are on in with that this".split(" "),
);
export const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
export function similarity(a: string, b: string): number {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

export class MockBrain implements Brain {
  name = "mock";
  async think(input: BrainInput): Promise<BrainOutput> {
    const out: BrainOutput = { items: [], updates: [], credits: [] };
    for (const l of input.burst) {
      const t = l.text.trim();
      const low = t.toLowerCase();
      const joking = /\b(lol|lmao|jk|haha|everything)\b|😂|🙃/.test(low);
      let m: RegExpMatchArray | null;
      // restated idea from someone else?
      const prior = input.memory.find((x) => x.kind === "idea" && x.from !== l.alias && similarity(x.text, t) >= 0.6);
      if (prior) {
        out.credits.push({ itemId: prior.id, restatedBy: l.alias, msg: l.n, confidence: 0.85 });
        continue;
      }
      if ((m = t.match(/(?:^|[.!?]\s+)(?:ok(?:ay)?,?\s+)?i(?:'ll| will| can| am going to|'m going to|'m gonna)\s+(.+?)(?:\s+by\s+(.+?))?[.!]*$/i))) {
        out.items.push({
          kind: "commitment",
          text: m[1]!.slice(0, 80),
          from: l.alias,
          owner: l.alias,
          due: m[2],
          msg: l.n,
          confidence: joking ? 0.3 : 0.9,
        });
      } else if ((m = t.match(/\b(?:let'?s go with|we(?:'ve)? decided(?: to)?|decided:|final answer:?)\s+(.+?)[.!]*$/i))) {
        out.items.push({ kind: "decision", text: m[1]!, from: l.alias, msg: l.n, confidence: 0.85 });
      } else if ((m = t.match(/\b(?:what if we|we should|maybe we could|how about we|idea:)\s+(.+?)[.!?]*$/i))) {
        out.items.push({ kind: "idea", text: m[1]!, from: l.alias, msg: l.n, confidence: joking ? 0.4 : 0.85 });
      }
      if ((m = t.match(/^(.+?)\s+(?:is|are)\s+(?:done|finished)\b/i))) {
        const target = input.memory.find((x) => x.status === "open" && similarity(x.text, m![1]!) >= 0.5);
        if (target) out.updates.push({ itemId: target.id, status: "done", confidence: 0.85 });
      }
    }
    if (input.question) {
      const open = input.memory.filter((x) => x.status === "open");
      out.reply = open.length
        ? `Still open: ${open.map((x) => x.text).slice(0, 5).join("; ")}.`
        : "Nothing open right now.";
    }
    return out;
  }
}

export function makeBrain(): Brain {
  const a = config.azure;
  if (a.endpoint && a.apiKey) {
    return new LLMBrain(
      `azure:${a.deployment}`,
      new AzureOpenAI({ endpoint: a.endpoint, apiKey: a.apiKey, apiVersion: a.apiVersion, deployment: a.deployment }),
      a.deployment,
    );
  }
  if (config.openai.apiKey) {
    return new LLMBrain(`openai:${config.openai.model}`, new OpenAI({ apiKey: config.openai.apiKey }), config.openai.model);
  }
  return new MockBrain();
}
