// Replay a scenario file and print what Keeper would do. Seconds per run, no phone needed.
//   npm run sim -- scenarios/credit.txt
//   npm run sim -- scenarios/credit.txt --save   (also writes the result to data/state.json for the tree page)
// Format: "Name: message" lines. "---" ends a burst (Keeper thinks). "@wait 30" skips 30 minutes.
import { readFileSync } from "node:fs";
import { makeBrain } from "./brain.ts";
import { config } from "./config.ts";
import { Keeper, listOpen } from "./keeper.ts";
import { Store } from "./store.ts";

const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
const save = process.argv.includes("--save");
if (!file) {
  console.error("usage: npm run sim -- scenarios/credit.txt");
  process.exit(1);
}

const c = { dim: "\x1b[2m", green: "\x1b[32m", cyan: "\x1b[36m", yellow: "\x1b[33m", reset: "\x1b[0m" };
let clock = Date.parse("2026-10-03T14:00:00Z");
const store = new Store(save ? config.dataFile : undefined); // in-memory unless --save
const brain = makeBrain();
const spaceKey = `sim:${file}`;
const keeper = new Keeper({
  store,
  brain,
  rules: { ...config.rules, burstMs: 0 },
  now: () => clock,
  outbox: {
    react: async (_s, ref) => console.log(`${c.green}   👍 tapback on "${ref}"${c.reset}`),
    send: async (_s, text, replyTo) => console.log(`${c.cyan}   Keeper${replyTo ? ` (reply to "${replyTo}")` : ""}: ${text}${c.reset}`),
  },
  log: (m) => console.log(`${c.dim}   [memory] ${m}${c.reset}`),
});

console.log(`${c.dim}brain: ${brain.name}${c.reset}\n`);
for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  if (line === "---") {
    await keeper.flushAll();
    continue;
  }
  const wait = line.match(/^@wait\s+(\d+)/);
  if (wait) {
    await keeper.flushAll();
    clock += Number(wait[1]) * 60_000;
    console.log(`${c.yellow}   ... ${wait[1]} minutes later${c.reset}`);
    await keeper.tick();
    continue;
  }
  const m = line.match(/^([^:]{1,24}):\s*(.+)$/);
  if (!m) continue;
  const [, name, text] = m as unknown as [string, string, string];
  console.log(`${name}: ${text}`);
  clock += 5_000;
  await keeper.receive({ spaceKey, senderKey: `sim:${name}`, senderName: name, text, isGroup: true, ref: text });
}
await keeper.flushAll();
console.log(`\n${c.dim}--- final memory ---${c.reset}\n${listOpen(store.chat(spaceKey))}`);
if (save) {
  store.chat(spaceKey).title ??= file.replace(/^.*\//, "").replace(/\.txt$/, "");
  store.save();
  console.log(`\nsaved to ${config.dataFile} as ${store.chat(spaceKey).id}`);
}
