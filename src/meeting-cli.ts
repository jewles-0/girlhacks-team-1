// Turn a meeting transcript (.txt "Name: text") or recording (.m4a/.mp3/.wav, via ElevenLabs) into tree items.
//   npm run meeting -- scenarios/meeting.txt "Sprint planning"
import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { makeBrain } from "./brain.ts";
import { config } from "./config.ts";
import { transcribe } from "./elevenlabs.ts";
import { listOpen } from "./keeper.ts";
import { ingestMeeting, parseTranscript } from "./meeting.ts";
import { Store } from "./store.ts";

const [file, title = "Meeting"] = process.argv.slice(2);
if (!file) {
  console.error('usage: npm run meeting -- <transcript.txt | recording.m4a> ["Title"]');
  process.exit(1);
}
const AUDIO: Record<string, string> = { ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".webm": "audio/webm", ".mp4": "video/mp4" };
const ext = extname(file).toLowerCase();
const turns = AUDIO[ext] ? await transcribe(readFileSync(file), file, AUDIO[ext]) : parseTranscript(readFileSync(file, "utf8"));
console.log(`${turns.length} turns from ${new Set(turns.map((t) => t.speaker)).size} speakers`);

const store = new Store(config.dataFile);
const { id, added } = await ingestMeeting(store, makeBrain(), config.rules, title, turns);
console.log(`saved as ${id} (${added} items). Tree: http://localhost:${config.api.port}/?chat=${id}\n`);
console.log(listOpen(store.chatByPublicId(id)!));
