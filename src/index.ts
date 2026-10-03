// Spectrum wiring: connects Keeper to iMessage (Photon), a self-hosted Mac line, or the terminal.
//   npm run dev       -> iMessage via Photon Spectrum Cloud (PROJECT_ID / PROJECT_SECRET)
//   npm run local     -> iMessage via a teammate's Mac (IMESSAGE_LOCAL_*)
//   npm run terminal  -> chat in your terminal, type "Priya: I'll do the slides by Friday"
//   npm run tree      -> only the API + tree page (reads data/state.json)
import { type Message, type Space, Spectrum, voice } from "spectrum-ts";
import { makeBrain } from "./brain.ts";
import { startApi } from "./api.ts";
import { config } from "./config.ts";
import { elevenlabsEnabled, transcribe, tts } from "./elevenlabs.ts";
import { Keeper, type Outbox } from "./keeper.ts";
import { Store } from "./store.ts";

const mode = (process.argv[2] ?? "imessage") as "imessage" | "local" | "terminal" | "api-only";
const store = new Store(config.dataFile);
const brain = makeBrain();
const api = startApi(store, brain);
console.log(`[keeper] mode=${mode} brain=${brain.name} voice=${elevenlabsEnabled() ? "elevenlabs" : "off"}`);

if (mode !== "api-only") await runBot();

async function runBot() {
  const app = await connect();
  const spaces = new Map<string, Space>();

  const outbox: Outbox = {
    async react(spaceKey, ref, emoji) {
      await (ref as Message | undefined)?.react(emoji);
    },
    async send(spaceKey, text, replyTo) {
      if (replyTo) await (replyTo as Message).reply(text);
      else await spaces.get(spaceKey)?.send(text);
    },
    async sendVoice(spaceKey, audio, replyTo) {
      const content = voice(audio, { mimeType: "audio/mpeg", name: "keeper-recap.mp3" });
      if (replyTo) await (replyTo as Message).reply(content);
      else await spaces.get(spaceKey)?.send(content);
    },
  };

  const keeper = new Keeper({ store, brain, outbox, rules: config.rules, tts, log: (m) => console.log(`[keeper] ${m}`) });
  const ticker = setInterval(() => void keeper.tick().catch((e) => console.error("[tick]", e)), 30_000);

  const shutdown = async () => {
    clearInterval(ticker);
    await keeper.flushAll().catch(() => {});
    store.save();
    api.close();
    await app.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  for await (const [space, message] of app.messages) {
    try {
      if (message.direction !== "inbound" || message.sender?.kind === "agent") continue;
      spaces.set(space.id, space);
      let text: string | undefined;
      const c = message.content;
      if (c.type === "text") text = c.text;
      else if (c.type === "voice" && elevenlabsEnabled()) {
        // voice notes become text (with ElevenLabs Scribe) so they're remembered too
        const turns = await transcribe(await c.read(), c.name ?? "voice.m4a", c.mimeType).catch(() => []);
        text = turns.map((t) => t.text).join(" ");
      }
      if (!text) continue;

      let senderKey = message.sender?.id ?? "unknown";
      let senderName: string | undefined;
      if (mode === "terminal") {
        // one human plays everyone: "Priya: I'll do the slides by Friday"
        const m = text.match(/^([\p{L}][\p{L} '-]{0,20}):\s*(.+)$/u);
        if (m) {
          senderName = m[1]!.trim();
          senderKey = `terminal:${senderName.toLowerCase()}`;
          text = m[2]!;
        }
      }
      const isGroup = mode === "terminal" ? true : (space as { type?: string }).type === "group";
      await keeper.receive({ spaceKey: space.id, senderKey, senderName, text, isGroup, ref: message });
    } catch (err) {
      console.error("[keeper] message failed:", err);
    }
  }
}

async function connect() {
  if (mode === "terminal") {
    const { terminal } = await import("spectrum-ts/providers/terminal");
    return Spectrum({ providers: [terminal.config()] });
  }
  const { imessage } = await import("spectrum-ts/providers/imessage");
  if (mode === "local") {
    // A self-hosted line (e.g. a teammate's Mac signed into Messages with a spare Apple ID).
    const l = config.photon.local;
    if (!l.address || !l.token || !l.phone) fail("Set IMESSAGE_LOCAL_ADDRESS, IMESSAGE_LOCAL_TOKEN and IMESSAGE_LOCAL_PHONE in .env");
    return Spectrum({
      projectId: config.photon.projectId,
      projectSecret: config.photon.projectSecret,
      providers: [imessage.config({ clients: { address: l.address, token: l.token, phone: l.phone } })],
    });
  }
  if (!config.photon.projectId || !config.photon.projectSecret) fail("Set PROJECT_ID and PROJECT_SECRET in .env (Photon dashboard)");
  return Spectrum({ projectId: config.photon.projectId, projectSecret: config.photon.projectSecret, providers: [imessage.config()] });
}

function fail(msg: string): never {
  console.error(`[keeper] ${msg}`);
  process.exit(1);
}
