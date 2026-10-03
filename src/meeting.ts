// "AI for the Modern Enterprise" (ADP) stretch: turn a messy meeting transcript or
// recording into the same commitments / decisions / ideas, credited to speakers.
import type { Brain } from "./brain.ts";
import type { Rules } from "./config.ts";
import { Keeper, type KeeperEvent, type Outbox } from "./keeper.ts";
import type { Store } from "./store.ts";
import type { Turn } from "./elevenlabs.ts";

const silent: Outbox = { react: async () => {}, send: async () => {} };

/** Parse "Name: text" lines (or plain lines) into turns. */
export function parseTranscript(raw: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^(?:\[[^\]]*\]\s*)?([\p{L}][\p{L}\p{N} ._'-]{0,30}):\s+(.+)$/u);
    if (m) turns.push({ speaker: m[1]!.trim(), text: m[2]!.trim() });
    else if (turns.length) turns.at(-1)!.text += ` ${t}`;
    else turns.push({ speaker: "Speaker", text: t });
  }
  return turns;
}

export async function ingestMeeting(
  store: Store,
  brain: Brain,
  rules: Rules,
  title: string,
  turns: Turn[],
  now: () => number = Date.now,
  onEvent?: (e: KeeperEvent) => void,
): Promise<{ code: string; title: string; added: number }> {
  const spaceKey = `meeting:${now()}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`;
  const chat = store.chat(spaceKey);
  chat.title = title || "Meeting";
  const before = chat.items.length;
  // a strict "silent" keeper: no unprompted messages, flushes every 12 turns
  const keeper = new Keeper({ store, brain, outbox: silent, rules: { ...rules, burstMs: 0, unpromptedDailyMax: 0 }, now, onEvent });
  let n = 0;
  for (const t of turns) {
    const pretty = /^speaker_(\d+)$/.exec(t.speaker);
    const name = pretty ? `Speaker ${Number(pretty[1]) + 1}` : t.speaker;
    await keeper.receive({ spaceKey, senderKey: `${spaceKey}:${t.speaker}`, senderName: name, text: t.text, isGroup: true });
    if (++n % 12 === 0) await keeper.flush(spaceKey);
  }
  await keeper.flush(spaceKey);
  for (const it of chat.items.slice(before)) it.source = "meeting";
  store.save();
  return { code: chat.code, title: chat.title, added: chat.items.length - before };
}
