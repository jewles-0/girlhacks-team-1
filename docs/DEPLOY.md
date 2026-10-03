# Deploy and demo

## Keep the bot running all weekend

The bot listens to iMessage through Spectrum, so it must stay running somewhere.

**Simplest: one laptop.** Plugged in, sleep disabled:
```bash
npm start            # macOS: caffeinate -i npm start
```
Memory is in `data/state.json`, so restarts are safe.

**Optional: Azure App Service** (also strengthens the Avanade entry). Any always-on Node host works:
```bash
az webapp up -n keeper-bot -g keeper-rg --runtime "NODE:22-lts" --sku B1
az webapp config appsettings set -n keeper-bot -g keeper-rg --settings PROJECT_ID=... PROJECT_SECRET=... AZURE_OPENAI_ENDPOINT=... AZURE_OPENAI_API_KEY=... API_HOST=0.0.0.0 API_PORT=8080 DATA_FILE=/home/data/state.json
az webapp config set -n keeper-bot -g keeper-rg --startup-file "npm start" --always-on true
```

## Share the website

The bot serves the website itself at `http://127.0.0.1:8787`. To reach it from other devices, open a public tunnel:
```bash
npx cloudflared tunnel --url http://localhost:8787
```
That prints an `https://....trycloudflare.com` URL. Trees can only be opened with their code, and wrong guesses are rate-limited. Set `INGEST_TOKEN=some-secret` in `.env` so only your team can upload meetings.

## DeepSpace

DeepSpace hosts apps on `<name>.app.space` (Cloudflare Workers). The bot needs a long-running process, so it stays on the laptop or Azure. DeepSpace hosts the **website** (code entry, tree, grove), which reads data from the bot's API.

```bash
npx create-deepspace keeper-grove
cd keeper-grove
npx deepspace auth login
mkdir -p public/grove && cp ../web/* public/grove/
# edit public/grove/index.html: <meta name="keeper-api" content="https://<your-bot-url>"> (or pass ?api= in the URL)
npm run dev        # http://localhost:.../grove/?api=https://<your-tunnel>.trycloudflare.com
npm run deploy     # https://keeper-grove.app.space/grove/?api=https://<your-tunnel>
```
Set `CORS_ORIGINS=https://keeper-grove.app.space` in the bot's `.env`.

To compete for "Best Use of DeepSpace" (stretch goal): use DeepSpace's auth so only chat members can see their grove, and its real-time sync instead of polling. The bot would POST items to a DeepSpace HTTP route (`src/server/http-routes.ts` in the DeepSpace app).

## Custom domain

The domain is the front door: someone types `keepergrove.xyz`, enters their chat's code, and sees their tree or grove.

1. Point the GoDaddy Registry domain at wherever the website runs:
   - DeepSpace: add it as a custom domain in DeepSpace and create the DNS record it asks for.
   - Azure web app: `az webapp config hostname add --webapp-name keeper-bot -g keeper-rg --hostname keepergrove.xyz`.
   - Quickest: domain forwarding to `https://keeper-grove.app.space/grove/?api=https://<bot-url>`.
2. Set `PUBLIC_URL=https://keepergrove.xyz` in the bot's `.env` (add `/grove` if you used the DeepSpace path), so `keeper code` replies link to it.
3. If the website and bot are on different hosts, add the domain to `CORS_ORIGINS`.

## Demo settings

In `.env` for the live demo, so moments happen within two minutes:
```
RESURFACE_AFTER_MIN=1
UNPROMPTED_COOLDOWN_MIN=1
```
Rehearse with `npm run sim -- scenarios/credit.txt` and `scenarios/edge-cases.txt`.
