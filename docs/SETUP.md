# Setup: keys and accounts

Everything goes in `.env` (copy it from `.env.example`). **Never commit `.env`** (it's in `.gitignore`).

| # | Service | Needed for | Who | Required? |
| --- | --- | --- | --- | --- |
| 1 | Photon Spectrum | The iMessage bot | Person A | Yes (for real iMessage) |
| 2 | Azure OpenAI (or OpenAI) | The "brain" | Person B | Recommended (mock brain works without) |
| 3 | ElevenLabs | Voice recaps, meeting transcription | Person B/C | Optional |
| 4 | Tiger Data | Growth history ("growth rings") | Person C | Optional (prize) |
| 5 | DeepSpace | Hosting the website | Person C | Optional (prize) |
| 6 | GoDaddy Registry domain | Where people type their tree code | Anyone | Optional (prize) |

## 1. Photon Spectrum (iMessage)

1. Sign in at https://photon.codes and apply the hackathon promo code (Pro plan).
2. **Add a phone number to your account** (avatar menu, top-right). The dashboard currently shows `account_phone_missing` until you do.
3. Your project id is `debff26c-6433-480f-b213-f7f7389b5f17`. Copy the project **secret** from the dashboard.
4. In `.env`: `PROJECT_ID=...` and `PROJECT_SECRET=...`
5. `npm run dev`, then text the line shown in the dashboard: `keeper help`.

Fallback (`npm run local`): a teammate's Mac signed into Messages with a spare Apple ID, running Photon's self-hosted iMessage server. Put its address, token and phone in `IMESSAGE_LOCAL_*`. Ask at the Photon table for the server setup; this path is untested.

## 2. Azure OpenAI (Avanade prize)

With the Azure for Students credit (https://azure.microsoft.com/free/students):

```bash
az login
az group create -n keeper-rg -l eastus
az cognitiveservices account create -n keeper-openai -g keeper-rg -l eastus --kind OpenAI --sku S0 --custom-domain keeper-openai
az cognitiveservices account deployment create -n keeper-openai -g keeper-rg \
  --deployment-name gpt-4o-mini --model-name gpt-4o-mini --model-version "2024-07-18" \
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10
az cognitiveservices account show -n keeper-openai -g keeper-rg --query properties.endpoint -o tsv   # -> AZURE_OPENAI_ENDPOINT
az cognitiveservices account keys list -n keeper-openai -g keeper-rg --query key1 -o tsv             # -> AZURE_OPENAI_API_KEY
```

Or use the portal: create an **Azure OpenAI** resource, then in **Azure AI Foundry** deploy `gpt-4o-mini` (or `gpt-4.1-mini`). If a model version isn't available in your region, pick the one the portal offers.

`.env`:
```
AZURE_OPENAI_ENDPOINT=https://keeper-openai.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-10-21
```

No Azure? Set `OPENAI_API_KEY` instead (you lose the Avanade prize eligibility). Check which brain is active: `curl localhost:8787/api/health`.

Cost: one small call per burst of messages. The whole weekend should cost a few dollars at most.

## 3. ElevenLabs (MLH prize)

1. Sign up at https://elevenlabs.io (MLH may have free credits at the event).
2. Profile → API Keys → create a key with **Text to Speech** and **Speech to Text** access.
3. `.env`: `ELEVENLABS_API_KEY=...`. Optional: change `ELEVENLABS_VOICE_ID` to any voice from the voice library.

What it powers:
- `keeper recap voice` in the chat → a voice-note summary.
- 🔊 **Recap** button on the tree page.
- **＋ Meeting** on the tree page / `npm run meeting -- recording.m4a`: transcribes with **speaker separation** (diarization), so each sentence is credited to the right voice. This answers the "which voice belongs to who" problem: speakers show up as Speaker 1, Speaker 2, ...
- iMessage voice notes get transcribed and remembered like text.

## 4. Tiger Data (MLH prize)

1. Sign up at https://console.cloud.timescale.com (Tiger Cloud, free tier).
2. Create a service, then copy its connection string (`postgres://tsdbadmin:...@....tsdb.cloud.timescale.com:3xxxx/tsdb?sslmode=require`).
3. `.env`: `TIGER_DATABASE_URL=...`
4. Restart. The log should say `[tiger] connected (TimescaleDB hypertable + continuous aggregate)`.

On first start Keeper creates everything itself:
- `keeper_events`: a **hypertable** with one row per sprout, bloom or credit.
- `keeper_growth_15m`: a **continuous aggregate** in 15-minute buckets, refreshed by a policy, with real-time results.
- **Compression** for history older than 7 days.
- A one-time backfill from `data/state.json`.

The tree page's "Growth rings" chart reads from it, and shows "· Tiger Data" when it does. Without a key, the same chart is computed from memory.

Show judges a query live:
```sql
SELECT bucket, event, n FROM keeper_growth_15m WHERE tree_id = 'MOSS-K7Q2XA' ORDER BY bucket;
```

Tested here against plain Postgres 16 (the fallback path). The TimescaleDB parts (hypertable, aggregate, compression) only run on Tiger Cloud, so check the startup log line there.

## 5. DeepSpace

See [DEPLOY.md](DEPLOY.md#deepspace). You need to log in with `npx deepspace auth login` (build credits come with the hackathon).

## 6. GoDaddy Registry domain (MLH prize)

Register a domain through the MLH GoDaddy Registry offer. Something that fits the theme works best, e.g. `keepergrove.xyz`, `findyourtree.tech` or `ourgrove.app`; MLH judges the name itself. Point it at the website (see [DEPLOY.md](DEPLOY.md#custom-domain)) and set `PUBLIC_URL=https://yourdomain` so `keeper code` replies link there.
