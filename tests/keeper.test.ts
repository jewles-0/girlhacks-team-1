// Behaviour tests for the hard rules. No API keys, no phone: `npm test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { publicChat } from "../src/api.ts";
import OpenAI from "openai";
import { type Brain, type BrainInput, type BrainOutput, LLMBrain, MockBrain, parseBrainOutput } from "../src/brain.ts";
import { wordsToTurns } from "../src/elevenlabs.ts";
import { Keeper, type Outbox } from "../src/keeper.ts";
import { ingestMeeting, parseTranscript } from "../src/meeting.ts";
import { normalizeCode, Store } from "../src/store.ts";
import { growthFromMemory } from "../src/tiger.ts";
import type { KeeperEvent } from "../src/keeper.ts";

const RULES = { burstMs: 0, minConfidence: 0.75, unpromptedDailyMax: 6, unpromptedCooldownMs: 0, resurfaceAfterMs: 60_000 };
const PRIYA = "+15551230001";
const JAKE = "+15551230002";
const MAYA = "+15551230003";

class FakeBrain implements Brain {
  name = "fake";
  calls: BrainInput[] = [];
  constructor(public next: Partial<BrainOutput> = {}) {}
  async think(input: BrainInput): Promise<BrainOutput> {
    this.calls.push(input);
    return { items: [], updates: [], credits: [], ...this.next };
  }
}

function setup(next: Partial<BrainOutput> = {}, rules = {}) {
  let clock = 1_000_000;
  const sent: { text: string; replyTo?: unknown }[] = [];
  const reacts: unknown[] = [];
  const outbox: Outbox = {
    react: async (_s, ref) => void reacts.push(ref),
    send: async (_s, text, replyTo) => void sent.push({ text, replyTo }),
  };
  const store = new Store();
  const brain = new FakeBrain(next);
  const keeper = new Keeper({ store, brain, outbox, rules: { ...RULES, ...rules }, now: () => clock });
  const say = (who: string, text: string, name?: string) =>
    keeper.receive({ spaceKey: "chat", senderKey: who, senderName: name, text, isGroup: true, ref: text });
  return { keeper, store, brain, sent, reacts, say, chat: () => store.chat("chat"), advance: (ms: number) => (clock += ms) };
}

/** Seed an idea from Priya (P1) as item i1. */
async function seedIdea(t: ReturnType<typeof setup>) {
  t.brain.next = { items: [{ kind: "idea", text: "survey users first", from: "P1", msg: 1, confidence: 0.9 }] };
  await t.say(PRIYA, "what if we survey users first", "Priya");
  await t.keeper.flushAll();
  await t.say(JAKE, "nah", "Jake");
  t.brain.next = {};
  await t.keeper.flushAll();
}

test("records confident items and taps back once, without sending a message", async () => {
  const t = setup({ items: [{ kind: "commitment", text: "do the slides", from: "P1", owner: "P1", due: "Friday", msg: 1, confidence: 0.9 }] });
  await t.say(PRIYA, "I'll do the slides by Friday");
  await t.keeper.flushAll();
  assert.equal(t.chat().items.length, 1);
  assert.equal(t.chat().items[0]!.owner, "P1");
  assert.deepEqual(t.reacts, ["I'll do the slides by Friday"]);
  assert.equal(t.sent.length, 0);
});

test("drops items below the confidence threshold", async () => {
  const t = setup({ items: [{ kind: "commitment", text: "do everything", from: "P1", owner: "P1", confidence: 0.4 }] });
  await t.say(PRIYA, "sure I'll do everything lol");
  await t.keeper.flushAll();
  assert.equal(t.chat().items.length, 0);
  assert.equal(t.reacts.length, 0);
});

test('"Maya can do the slides" from someone else never becomes Maya\'s task', async () => {
  const t = setup();
  await t.say(MAYA, "hi", "Maya"); // Maya = P1
  t.brain.next = { items: [{ kind: "commitment", text: "do the slides", from: "P2", owner: "P1", confidence: 0.95 }] };
  await t.say(PRIYA, "Maya can do the slides", "Priya"); // Priya = P2
  await t.keeper.flushAll();
  assert.equal(t.chat().items.length, 0);
});

test("credits the original author and never names the restater", async () => {
  const t = setup();
  await seedIdea(t);
  t.brain.next = { credits: [{ itemId: "i1", restatedBy: "P2", confidence: 0.9 }] };
  // even if the stored text somehow contains the restater's name, it is removed
  t.chat().items[0]!.text = "Jake says survey users first";
  await t.say(JAKE, "we should survey users first");
  await t.keeper.flushAll();
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0]!.text, /Priya/);
  assert.doesNotMatch(t.sent[0]!.text, /Jake|P2/);
});

test("no credit when the original author repeats their own idea", async () => {
  const t = setup();
  await seedIdea(t);
  t.brain.next = { credits: [{ itemId: "i1", restatedBy: "P1", confidence: 0.95 }] };
  await t.say(PRIYA, "again, survey users first!");
  await t.keeper.flushAll();
  assert.equal(t.sent.length, 0);
});

test("credit is given at most once per idea", async () => {
  const t = setup();
  await seedIdea(t);
  t.brain.next = { credits: [{ itemId: "i1", restatedBy: "P2", confidence: 0.9 }] };
  await t.say(JAKE, "we should survey users first");
  await t.keeper.flushAll();
  await t.say(JAKE, "seriously, survey users first");
  await t.keeper.flushAll();
  assert.equal(t.sent.length, 1);
});

test("quiet mode blocks unprompted messages and tapbacks but still remembers", async () => {
  const t = setup();
  await seedIdea(t);
  await t.say(PRIYA, "keeper quiet 30m");
  t.sent.length = 0;
  t.reacts.length = 0;
  t.brain.next = {
    credits: [{ itemId: "i1", restatedBy: "P2", confidence: 0.9 }],
    items: [{ kind: "idea", text: "dark mode", from: "P2", msg: 1, confidence: 0.9 }],
  };
  await t.say(JAKE, "survey users first + dark mode");
  await t.keeper.flushAll();
  assert.equal(t.sent.length, 0);
  assert.equal(t.reacts.length, 0);
  assert.equal(t.chat().items.length, 2);
});

test("daily cap on unprompted messages", async () => {
  const t = setup({}, { unpromptedDailyMax: 2 });
  assert.equal(t.keeper.gate(t.chat()), true);
  assert.equal(t.keeper.gate(t.chat()), true);
  assert.equal(t.keeper.gate(t.chat()), false);
  t.advance(86_400_001);
  assert.equal(t.keeper.gate(t.chat()), true);
});

test("cooldown between unprompted messages", async () => {
  const t = setup({}, { unpromptedCooldownMs: 60_000 });
  assert.equal(t.keeper.gate(t.chat()), true);
  t.advance(30_000);
  assert.equal(t.keeper.gate(t.chat()), false);
  t.advance(31_000);
  assert.equal(t.keeper.gate(t.chat()), true);
});

test("commands never call the model", async () => {
  const t = setup();
  for (const c of ["keeper help", "keeper list", "keeper quiet 10m", "keeper unquiet", "keeper call me Priya", "keeper recap", "keeper done 1", "keeper code", "keeper name Team Seed"]) {
    await t.say(PRIYA, c);
  }
  await t.keeper.flushAll();
  assert.equal(t.brain.calls.length, 0);
  assert.equal(t.chat().people[PRIYA]!.name, "Priya");
});

test("keeper forget everything wipes memory", async () => {
  const t = setup();
  await seedIdea(t);
  await t.say(PRIYA, "keeper forget everything");
  assert.equal(t.chat().items.length, 0);
  assert.equal(t.chat().recent.length, 0);
});

test("the model never sees phone numbers", async () => {
  const t = setup();
  await t.say(PRIYA, "hello", "Priya");
  await t.say(JAKE, "hey");
  await t.keeper.flushAll();
  const seen = JSON.stringify(t.brain.calls);
  assert.doesNotMatch(seen, /555123/);
  assert.match(seen, /P1/);
});

test("replies to direct questions are threaded and scrub phone numbers", async () => {
  const t = setup({ reply: "call +1 555 123 0002 for help" });
  await t.say(JAKE, "keeper who has the slides?");
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0]!.replyTo, "keeper who has the slides?");
  assert.doesNotMatch(t.sent[0]!.text, /555/);
});

test("talk-time stats are never posted in a group", async () => {
  const t = setup();
  await t.say(PRIYA, "keeper me");
  assert.doesNotMatch(t.sent[0]!.text, /%/);
});

test("forgotten ideas resurface once, after the delay", async () => {
  const t = setup();
  await seedIdea(t);
  await t.keeper.tick();
  assert.equal(t.sent.length, 0);
  t.advance(61_000);
  await t.keeper.tick();
  await t.keeper.tick();
  assert.equal(t.sent.length, 1);
  assert.match(t.sent[0]!.text, /Priya's idea/);
});

test("tree API data has no phone numbers or message text", async () => {
  const t = setup();
  await seedIdea(t);
  const out = JSON.stringify(publicChat(t.chat()));
  assert.doesNotMatch(out, /555123/);
  assert.doesNotMatch(out, /what if we/);
  assert.match(out, /Priya/);
});

test("parseBrainOutput survives garbage and partial JSON", () => {
  assert.deepEqual(parseBrainOutput("not json"), { items: [], updates: [], credits: [], reply: undefined });
  const out = parseBrainOutput('Sure! {"items":[{"kind":"idea","text":"x","from":"P1","confidence":2},{"kind":"bogus"}],"reply":"null"}');
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0]!.confidence, 1);
  assert.equal(out.reply, undefined);
});

test("mock brain ignores sarcasm and volunteering others", async () => {
  const b = new MockBrain();
  const out = await b.think({
    people: [],
    memory: [],
    context: [],
    burst: [
      { n: 1, alias: "P1", text: "sure I'll do everything lol" },
      { n: 2, alias: "P2", text: "Maya can do the slides" },
    ],
  });
  assert.ok(out.items.every((i) => i.confidence < RULES.minConfidence));
});

test("meeting transcripts and diarized audio become credited items", async () => {
  const turns = parseTranscript("Alex: I'll write the copy by Wednesday\nSam: what if we mock the payroll API");
  assert.equal(turns.length, 2);
  const diarized = wordsToTurns([
    { text: "Hi", speaker_id: "speaker_0" },
    { text: " there", speaker_id: "speaker_0" },
    { text: "Hello", speaker_id: "speaker_1" },
  ]);
  assert.deepEqual(diarized.map((x) => x.speaker), ["speaker_0", "speaker_1"]);
  const store = new Store();
  const { code, added } = await ingestMeeting(store, new MockBrain(), RULES, "Sync", turns);
  assert.equal(added, 2);
  const pub = publicChat(store.chatByCode(code)!);
  assert.deepEqual(pub.items.map((i) => i.from).sort(), ["Alex", "Sam"]);
  assert.ok(pub.items.every((i) => i.source === "meeting"));
});

test("tree codes are readable, unique per chat, and forgiving to type", () => {
  const store = new Store();
  const a = store.chat("a");
  const b = store.chat("b");
  assert.match(a.code, /^[A-Z]+-[A-HJ-NP-Z2-9]{6}$/);
  assert.notEqual(a.code, b.code);
  assert.equal(normalizeCode(` ${a.code.toLowerCase().replace("-", " ")} `), a.code);
  assert.equal(store.chatByCode(a.code.toLowerCase())?.code, a.code);
  assert.equal(store.chatByCode("MOSS-AAAAAA"), undefined);
});

test("keeper code shares the tree code; keeper grove is only sent 1:1", async () => {
  const t = setup();
  await t.say(PRIYA, "keeper code");
  assert.match(t.sent[0]!.text, new RegExp(t.chat().code));
  await t.say(PRIYA, "keeper grove");
  assert.doesNotMatch(t.sent[1]!.text, /GROVE-/);
  await t.keeper.receive({ spaceKey: "dm", senderKey: PRIYA, text: "keeper grove", isGroup: false, ref: "dm" });
  assert.match(t.sent[2]!.text, /GROVE-[A-Z0-9]{6}/);
});

test("a grove holds every group tree the person is in, and nobody else's", async () => {
  const store = new Store();
  const add = (space: string, who: string) => {
    const c = store.chat(space);
    store.person(c, who);
    return c;
  };
  add("team", PRIYA);
  add("club", PRIYA);
  add("other", JAKE);
  store.chat("dm").isDm = true;
  store.person(store.chat("dm"), PRIYA);
  const grove = store.groveByCode(store.groveCode(PRIYA))!;
  assert.deepEqual(grove.map((c) => c.id).sort(), [store.chat("club").id, store.chat("team").id].sort());
  assert.equal(store.groveByCode("GROVE-AAAAAA"), undefined);
});

test("growth history: events are emitted and rings are cumulative", async () => {
  const events: KeeperEvent[] = [];
  let clock = 0;
  const store = new Store();
  const keeper = new Keeper({
    store,
    brain: new FakeBrain({ items: [{ kind: "commitment", text: "slides", from: "P1", owner: "P1", confidence: 0.9 }] }),
    outbox: { react: async () => {}, send: async () => {} },
    rules: RULES,
    now: () => clock,
    onEvent: (e) => events.push(e),
  });
  await keeper.receive({ spaceKey: "c", senderKey: PRIYA, text: "I'll do slides", isGroup: true });
  await keeper.flushAll();
  clock = 60 * 60_000;
  await keeper.receive({ spaceKey: "c", senderKey: PRIYA, text: "keeper done 1", isGroup: true });
  assert.deepEqual(events.map((e) => e.event), ["created", "done"]);
  assert.equal(events[0]!.treeId, store.chat("c").code);
  const g = growthFromMemory(store.chat("c"));
  assert.deepEqual(g.points.map((p) => [p.planted, p.bloomed]), [[1, 0], [1, 1]]);
});

test("models that reject a custom temperature (gpt-5 etc.) still work", async () => {
  const sent: Record<string, unknown>[] = [];
  const fake = {
    chat: {
      completions: {
        create: async (body: Record<string, unknown>) => {
          sent.push(body);
          if ("temperature" in body) {
            throw new OpenAI.BadRequestError(400, { message: "Unsupported value: 'temperature' does not support 0.2" }, undefined, new Headers());
          }
          return { choices: [{ message: { content: '{"items":[{"kind":"idea","text":"x","from":"P1","confidence":0.9}]}' } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const brain = new LLMBrain("azure:gpt-5-mini", fake, "gpt-5-mini");
  const input: BrainInput = { people: [], memory: [], context: [], burst: [{ n: 1, alias: "P1", text: "x" }] };
  assert.equal((await brain.think(input)).items.length, 1);
  assert.equal((await brain.think(input)).items.length, 1);
  assert.deepEqual(sent.map((b) => "temperature" in b), [true, false, false]); // retried once, then remembered
});
