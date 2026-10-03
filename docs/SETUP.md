# Setup: keys and accounts

Everything goes in `.env` (copy it from `.env.example`). **Never commit `.env`** (it's in `.gitignore`).

| # | Service | Needed for | Who | Required? |
| --- | --- | --- | --- | --- |
| 1 | Photon Spectrum | The iMessage bot | Person A | Yes (for real iMessage) |
| 2 | Azure OpenAI (or OpenAI) | The "brain" | Person B | Recommended (mock brain works without) |
| 3 | ElevenLabs | Voice recaps, meeting transcription | Person B/C | Optional |
| 4 | DeepSpace | Hosting the tree page | Person C | Optional (prize) |
| 5 | GoDaddy Registry domain | Custom domain | Anyone | Optional (prize) |

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

## 4. DeepSpace

See [DEPLOY.md](DEPLOY.md#deepspace). You need to log in with `npx deepspace auth login` (build credits come with the hackathon).

## 5. GoDaddy Registry domain (MLH prize)

Register a domain through the MLH GoDaddy Registry offer (e.g. a `.tech`, `.xyz` or similar like `keepergrove.xyz`). Point it at the tree page; see [DEPLOY.md](DEPLOY.md#custom-domain).
