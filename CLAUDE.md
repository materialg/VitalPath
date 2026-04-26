# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` / `npm start` — runs `tsx server.ts`. Boots an Express server on port 3000 that mounts Vite in middleware mode AND exposes the `/api/ai/*` proxy routes. There is no separate Vite dev server — both frontend HMR and API requests go through the same port.
- `npm run build` — `vite build` (outputs to `dist/`). `server.ts` serves `dist/` when `NODE_ENV=production`.
- `npm run lint` — `tsc --noEmit`. There is no ESLint script despite `eslint.config.js` / `@firebase/eslint-plugin-security-rules` being installed.
- No test runner is configured. Tests referenced in `security_spec.md` are conceptual, not wired up.
- Secrets: set `GEMINI_API_KEY` in a local `.env` (loaded via `dotenv` in `server.ts`). The server also accepts `GEMINI_KEY`, `GOOGLE_API_KEY`, `GOOGLE_KEY`, `VITE_GEMINI_API_KEY`, or `API_KEY` as fallbacks.

## Architecture

**App shell (`src/App.tsx`)** is a single-page React 19 app with a tab router (`activeTab` state), no React Router. Top-level flow: Firebase auth → load/create user profile in Firestore → render one of `Dashboard | VitalsTracker | MealPlanner | WorkoutCoach | FoodBank`. Profile is kept in sync via `onSnapshot`.

**Firestore data model** (enforced by `firestore.rules`, documented in `firebase-blueprint.json`): everything lives under `/users/{uid}/...` with subcollections `vitals`, `mealPlans`, `groceryLists`, `workouts`, `dailyTargets`, `foodBank`. `firestore.rules` has a `match /{document=**} { allow read, write: if false }` global deny and per-path validator functions (`isValidUserProfile`, `isValidVitalLog`, `isValidFoodBankItem`, ...). When adding new fields to any of these docs you MUST also extend the corresponding validator, or writes will silently fail with `permission-denied`. The client-side `UserProfile`/`VitalLog`/etc. types live in `src/types.ts`.

**Firebase client config** is read from `firebase-applet-config.json` (committed, public values only). Note the non-default Firestore database ID `ai-studio-697f598a-...` — `src/firebase.ts` picks it up from that JSON; don't hardcode `(default)`.

**AI integration — two parallel implementations, do not duplicate work:**
- `server.ts` — the active path in local dev and whatever Node host runs `npm start`. Endpoints: `GET /api/ai/config` (presence check), `POST /api/ai/generate` (Gemini proxy), `GET /api/ai/debug` (env diagnostic). Default model: `gemini-3-flash-preview`.
- `api/ai/config.ts` + `api/ai/generate.ts` — Vercel serverless handlers that mirror the same contract. Default model here is `gemini-2.0-flash`. Imports `@vercel/node` which is **not** in `package.json`, so these only compile under a Vercel build. Git history shows these were removed and re-added; treat them as a deployment target variant, keep the request/response shape identical to `server.ts`.
- The browser NEVER calls Gemini directly. `src/services/aiService.ts` `callAI()` only hits `/api/ai/generate`. The `GoogleGenAI` import on the client is used solely for the `Type` enum when building `responseSchema`.

**Meal/workout generation (`src/services/aiService.ts`)** is the most important non-UI module:
- `calculateDailyTargets(profile, weight, bodyFat)` — Mifflin-St Jeor BMR × activity multiplier + step calories, then a deficit sized to hit `goalBodyFat` by `targetDate`. Height is stored in **inches**, weight in **pounds** (converted internally to metric). Minimum calorie floor: 1500 male / 1200 female.
- `generateMealPlan` fans out 7 parallel Gemini calls (one per weekday) constrained to items from the user's Food Bank. After the model returns, the code **recomputes macros from the Food Bank** — the model's claimed numbers are discarded. Keep this invariant: never trust model-reported macros, always recompute from `foodBankItems`.
- `regenerateDayPlan` preserves meals with `status === 'completed'` and scales the remaining meals' ingredient amounts to hit the remaining daily budget.
- `handleFirestoreError(error, operationType, path)` is the canonical error funnel for all Firestore writes; use it rather than raw try/catch when adding new persistence code.

## Conventions

- Visual style is hardcoded Tailwind utility classes using the palette `#141414` (text/ink), `#E4E3E0` (background), white cards. No theme tokens or CSS variables — copy the pattern from existing components.
- Path alias `@/*` resolves to the repo root (`vite.config.ts`, `tsconfig.json`), but most imports use relative paths; match whatever the sibling files use.
- `src/index.css` loads Tailwind v4 via `@tailwindcss/vite` — there is no `tailwind.config.js`.
