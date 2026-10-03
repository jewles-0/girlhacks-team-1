// ElevenLabs: text-to-speech for voice recaps, and speech-to-text with speaker
// diarization (who said what) for meeting recordings and iMessage voice notes.
import { config } from "./config.ts";

const BASE = "https://api.elevenlabs.io/v1";

export const elevenlabsEnabled = () => !!config.elevenlabs.apiKey;

/** Text -> MP3 bytes. Returns undefined when no key is configured. */
export async function tts(text: string): Promise<Buffer | undefined> {
  const { apiKey, voiceId, ttsModel } = config.elevenlabs;
  if (!apiKey) return undefined;
  const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: text.slice(0, 2500), model_id: ttsModel }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

export interface Turn {
  speaker: string; // "speaker_0", "speaker_1", ...
  text: string;
}

/** Audio -> speaker-separated turns (diarized). */
export async function transcribe(audio: Buffer, filename = "audio.m4a", mimeType = "audio/mp4"): Promise<Turn[]> {
  const { apiKey, sttModel } = config.elevenlabs;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY is not set");
  const form = new FormData();
  form.append("model_id", sttModel);
  form.append("diarize", "true");
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  const res = await fetch(`${BASE}/speech-to-text`, { method: "POST", headers: { "xi-api-key": apiKey }, body: form });
  if (!res.ok) throw new Error(`ElevenLabs STT ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { text?: string; words?: { text: string; type?: string; speaker_id?: string }[] };
  return wordsToTurns(data.words ?? [], data.text ?? "");
}

export function wordsToTurns(words: { text: string; type?: string; speaker_id?: string }[], fallback = ""): Turn[] {
  const turns: Turn[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    const speaker = w.speaker_id ?? "speaker_0";
    const last = turns.at(-1);
    if (last && last.speaker === speaker) last.text += w.text;
    else if (w.text.trim()) turns.push({ speaker, text: w.text });
  }
  for (const t of turns) t.text = t.text.replace(/\s+/g, " ").trim();
  if (!turns.length && fallback.trim()) turns.push({ speaker: "speaker_0", text: fallback.trim() });
  return turns.filter((t) => t.text);
}
