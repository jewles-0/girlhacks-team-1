// Central place for every environment variable. Everything else imports `config`.
try {
  process.loadEnvFile(".env");
} catch {
  // no .env file: fine for tests and the mock brain
}

const env = (k: string, d = "") => (process.env[k] ?? "").trim() || d;
const num = (k: string, d: number) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) && process.env[k] !== "" && process.env[k] !== undefined ? v : d;
};

export const config = {
  photon: {
    projectId: env("PROJECT_ID"),
    projectSecret: env("PROJECT_SECRET"),
    local: {
      address: env("IMESSAGE_LOCAL_ADDRESS"),
      token: env("IMESSAGE_LOCAL_TOKEN"),
      phone: env("IMESSAGE_LOCAL_PHONE"),
    },
  },
  azure: {
    endpoint: env("AZURE_OPENAI_ENDPOINT"),
    apiKey: env("AZURE_OPENAI_API_KEY"),
    deployment: env("AZURE_OPENAI_DEPLOYMENT", "gpt-4o-mini"),
    apiVersion: env("AZURE_OPENAI_API_VERSION", "2024-10-21"),
  },
  openai: {
    apiKey: env("OPENAI_API_KEY"),
    model: env("OPENAI_MODEL", "gpt-4o-mini"),
  },
  elevenlabs: {
    apiKey: env("ELEVENLABS_API_KEY"),
    voiceId: env("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
    ttsModel: env("ELEVENLABS_TTS_MODEL", "eleven_flash_v2_5"),
    sttModel: env("ELEVENLABS_STT_MODEL", "scribe_v1"),
  },
  rules: {
    burstMs: num("BURST_SECONDS", 6) * 1000,
    minConfidence: num("MIN_CONFIDENCE", 0.75),
    unpromptedDailyMax: num("UNPROMPTED_DAILY_MAX", 6),
    unpromptedCooldownMs: num("UNPROMPTED_COOLDOWN_MIN", 20) * 60_000,
    resurfaceAfterMs: num("RESURFACE_AFTER_MIN", 120) * 60_000,
  },
  api: {
    port: num("API_PORT", 8787),
    host: env("API_HOST", "127.0.0.1"),
    corsOrigins: env("CORS_ORIGINS", "*").split(",").map((s) => s.trim()),
  },
  dataFile: env("DATA_FILE", "data/state.json"),
};

export type Rules = typeof config.rules;
