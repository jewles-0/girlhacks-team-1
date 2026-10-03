# Agent instructions

Keeper is a Spectrum (spectrum-ts) iMessage agent written in TypeScript. Read README.md first.

- After every change run `npm test` and `npm run typecheck`. Both must pass.
- Hard rules (confidence threshold, quiet mode, rate limits, the credit message never naming the restater, no phone numbers sent to the model or the API) live in `src/keeper.ts` and `src/api.ts`. Never move them into the prompt.
- Tune model behaviour in `src/prompts.ts` and check it with `npm run sim -- scenarios/<file>.txt`.
- Never commit `.env` or `data/state.json`.
- Spectrum docs: https://photon.codes/docs/spectrum-ts
