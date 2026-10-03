# Seed 🌱 (Keeper)

Keeper is a quiet member of your iMessage group chat. It remembers **who committed to what**, **what was decided**, and **whose idea it was**. When someone's idea gets talked over and restated later, Keeper credits the person who said it first. Everything grows into a glowing tree on the **Keeper Grove** web page.

GirlHacks 2026 · tracks: Photon (Spectrum), Best Use of Azure by Avanade, ElevenLabs (MLH), AI for the Modern Enterprise by ADP, Enchanted Grove, DeepSpace, GoDaddy domain.

```
 iMessage group ──► Photon Spectrum ──► Keeper bot (Node/TypeScript) ──► Azure OpenAI (one call per burst)
                                            │   └─► ElevenLabs (voice recaps, meeting transcription)
                                            ▼
                                    data/state.json ──► /api/chats/g1 ──► Keeper Grove tree page (web/)
```

## Quick start (no keys needed)

Requires **Node 22** (20.12+ works).

```bash
npm install
npm test               # 19 behaviour tests, no API key needed
npm run typecheck      # no errors
npm run terminal       # chat with Keeper in your terminal: type  Priya: I'll do the slides by Friday
npm run sim -- scenarios/credit.txt           # replay a conversation and see what Keeper would do
npm run sim -- scenarios/credit.txt --save    # ...and save it so the tree page has data
npm run tree           # open http://127.0.0.1:8787 to see the tree
```

Without an AI key, Keeper uses a simple rule-based "mock brain". Add a key (below) for the real thing.

## Going live

1. `cp .env.example .env` and fill in the keys (see [docs/SETUP.md](docs/SETUP.md) for where to get each one).
2. `npm run dev`, then text your Photon number `keeper help` 1:1. It should reply.
3. Add the number to a group chat and send `keeper help` there. **Test this first** (see "Do first" in the plan).
4. Open http://127.0.0.1:8787 to watch the tree grow.

If the shared Photon number can't join a group, try in order: ask the Photon table for a dedicated line, `npm run local` on a teammate's Mac, or demo the group with `npm run terminal`.

## Commands (in the chat)

| Say | What happens |
| --- | --- |
| *(nothing)* | Keeper stays silent. 👍 tapback when it records something |
| `keeper help` | What Keeper does |
| `keeper list` / `keeper what's still open?` | Open commitments, decisions, ideas |
| `keeper done 3` / `keeper drop 3` | Mark item #3 done / dropped |
| `keeper recap` / `keeper recap voice` | Summary, as text or an ElevenLabs voice note |
| `keeper call me Priya` | Use your name instead of P1 |
| `keeper quiet 30m` / `keeper unquiet` | Pause unprompted messages |
| `keeper me` (in a 1:1 DM) | Your own talk-time stats; never posted in the group |
| `keeper forget everything` | Wipe this chat's memory |
| `keeper <any question>` | Answered from memory by the model, as a threaded reply |

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Bot on iMessage via Photon (auto-restarts on code changes) |
| `npm start` | Same, without auto-restart (use this to leave it running all weekend) |
| `npm run local` | Bot on a self-hosted iMessage line (teammate's Mac) |
| `npm run terminal` | Bot in your terminal, no phone needed |
| `npm run tree` | Only the API + tree page |
| `npm run sim -- <file>` | Replay a scenario from `scenarios/` |
| `npm run meeting -- <file> "Title"` | Turn a meeting transcript (.txt) or recording (.m4a/.mp3/.wav) into tree items |
| `npm test` / `npm run typecheck` | Run after every change |

## Where to change what

| File | What lives there | Owner |
| --- | --- | --- |
| `src/prompts.ts` | Personality, rules, what the model sees | B |
| `src/keeper.ts` | Hard rules: confidence, quiet mode, rate limits, credit never names the restater, commands | A |
| `src/index.ts` | Spectrum wiring, sending, the run modes | A |
| `src/brain.ts` | One structured model call (Azure OpenAI / OpenAI / mock), defensive parsing | B |
| `src/elevenlabs.ts` | Voice recaps (text-to-speech) and meeting transcription with speaker labels | B/C |
| `src/meeting.ts` | Meeting transcripts → items (ADP track) | C |
| `src/api.ts` + `web/` | Data for the tree page, and the page itself | C |
| `src/store.ts` | Memory format (`data/state.json`) | A |
| `scenarios/*.txt`, `tests/` | Demo conversations and behaviour tests | B and C |

## Why it's built this way

- **One model call per burst, not per message.** Keeper waits ~6 seconds for people to finish typing.
- **Commands never call the model.** They're instant and free.
- **The model proposes; the code decides.** Rate limits, quiet mode and credit rules live in `keeper.ts`, and the tests prove them.
- **The model never sees phone numbers.** People are P1, P2... The tree API never returns phone numbers or message text.

## API (for the tree page)

| Endpoint | Returns |
| --- | --- |
| `GET /api/chats` | `[{ id, title, items }]` |
| `GET /api/chats/g1` | `{ id, title, people, items: [{ id, kind, text, status, from, owner, due, source, credited }], stats }` |
| `GET /api/chats/g1/recap` / `recap.mp3` | Spoken summary (text / ElevenLabs MP3) |
| `POST /api/meetings?title=...` | Body: transcript text, or audio file. Returns `{ id, added }` |

## Docs

- [docs/SETUP.md](docs/SETUP.md): every key and account you need, and where to get it
- [docs/DEPLOY.md](docs/DEPLOY.md): keeping it running, DeepSpace, custom domain, demo settings

## How to run

See Quick start above.

Link to Presentation:
