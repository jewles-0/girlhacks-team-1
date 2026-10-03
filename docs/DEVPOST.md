# Devpost draft: Keeper Grove

> Draft for the team to rewrite in your own words. Devpost asks which AI tools you used: list Claude Code and the Azure model honestly.

## Inspiration
In every group project, someone's idea gets talked over, and ten minutes later someone else says it and gets the credit. Student teams, club boards and friend groups plan everything in iMessage group chats, and they lose the same three things every week: who said they'd do what, what was decided, and the quieter person's good idea.

## What it does
**Keeper** is a quiet member of your group chat. Add its number and keep talking normally.
- It stays **silent by default**. A 👍 tapback means it remembered something. It sends at most 6 unprompted messages a day.
- It remembers **commitments** ("I'll do the slides by Friday"), **decisions** and **ideas**, with who said each first.
- When an idea is restated, it **credits the original person** without naming the person who restated it.
- `keeper code` gives your chat a **tree code**. Type it on **our domain** to see your tree: each person is a branch, tasks are leaves, decisions are flowers, ideas are glowing seeds. Finished work glows gold.
- In several groups? `keeper grove` (sent privately) shows all your trees together as an **Enchanted Grove**.
- **Meetings too:** upload a recording and ElevenLabs separates the speakers, so every action item lands on the right person's branch.
- `keeper recap voice` sends a natural-sounding voice note of where things stand.

## How we built it
| Tool | How we used it |
| --- | --- |
| Photon Spectrum (`spectrum-ts`) | iMessage line, tapbacks, threaded replies, voice notes |
| Azure OpenAI (gpt-4o-mini) | One structured JSON call per burst of messages. The model proposes and our code decides |
| ElevenLabs | Text-to-speech recaps; Scribe speech-to-text with diarization for meetings and voice notes |
| Tiger Data | Hypertable of growth events + 15-minute continuous aggregate → "growth rings" chart; compression policy |
| DeepSpace | Hosts the website on `.app.space` |
| GoDaddy Registry | Our domain: the front door where you type your tree code |

Hard rules live in code, not the prompt: a 75% confidence threshold, quiet mode, rate limits, the credit message never naming the restater, and the model never seeing phone numbers (people are P1, P2…). These are covered by 23 behaviour tests that run without an API key.

## Challenges
- Telling restating apart from agreeing, and sarcasm ("sure I'll do everything lol") apart from real commitments.
- Volunteering someone else ("Maya can do the slides") must not become Maya's task.
- Knowing which voice is whose in meetings → speaker diarization.
- Privacy: trees open only with a code, and grove codes only go out in 1:1 messages.

## Accomplishments
- Real GirlHacks teams using it this weekend: **_N_ chats, _N_ commitments, _N_ ideas credited** (fill in from `npm run tree` output).

## What we learned
(each teammate: one sentence about the part you owned)

## What's next
Slack/WhatsApp (Spectrum supports them), calendar reminders for due dates, and team-level groves for clubs.

---

## 2-minute demo script
1. **Hook (15 s):** "Someone's idea gets ignored, then someone else says it and gets the credit. Keeper makes sure that doesn't happen."
2. **Live chat (45 s):** Priya suggests surveying users; Jake talks over it. Maya: "I'll do the mockups tonight" → 👍 only. Jake restates the survey idea → Keeper credits Priya.
3. **Website (30 s):** "keeper code" → open the domain, type the code → the tree. Then a grove code → the Enchanted Grove. Point at the growth rings: "that's Tiger Data."
4. **Voice + meetings (20 s):** press 🔊 Recap (ElevenLabs). Upload a short meeting clip → new branches per speaker (ADP).
5. **Trust (10 s):** "Phone numbers never reach the model, trees need a code, and stats are only shown to you."

Demo `.env`: `RESURFACE_AFTER_MIN=1`, `UNPROMPTED_COOLDOWN_MIN=1`.

## Judge questions to rehearse
- *Isn't this surveillance?* Everyone in the chat added it. It never reports to a manager, stats go only to the person, and `keeper forget everything` wipes it.
- *What if it's wrong about who said it first?* It only acts at 75%+ confidence, never names the restater, and credit reads as a mention, not an accusation.
- *Why Tiger Data instead of the JSON file?* The JSON file holds the current tree. Tiger holds the history: a time-series of every event, rolled up by a continuous aggregate, so growth charts stay fast across many groves.
