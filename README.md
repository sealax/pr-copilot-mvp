# PR Copilot (MVP)

PR Copilot is an AI-powered PR readiness and content generation tool for founders and operators preparing serious market-entry announcements.

It is designed to challenge weak stories before they go near journalists.

**Status:** Local MVP working. Not yet production-ready.

---

## What It Does

PR Copilot helps users:

- assess whether an announcement is actually ready for PR
- identify weaknesses and likely failure points
- simulate likely journalist reaction
- generate a press release draft only after evaluation

This is not a generic AI writing tool.

It is:

- a decision engine first
- a content generator second
- structured
- opinionated
- designed to reduce reputational risk

---

## Current MVP Scope

The current MVP supports two core flows:

### 1. PR Readiness Evaluation

The user submits a structured announcement and PR Copilot evaluates it.

Current evaluation output includes:

- verdict: `GO`, `CONDITIONAL`, or `NO-GO`
- primary failure modes
- journalist reaction simulation
- recommendation and next actions

Evaluation must run before generation.

### 2. Press Release Generation

Once evaluation has run, the user can generate a press release draft.

Generation is blocked if the verdict is `NO-GO`.

---

## Current Architecture

### API Routes

#### `/api/evaluate`

Handles structured PR readiness evaluation.

Current behaviour:

- sends announcement data to OpenAI
- expects structured JSON output
- validates and clamps scores server-side
- verifies the Supabase user from the bearer token
- saves the normalized evaluation to Supabase
- does not persist raw model output for new evaluations
- returns structured evaluation results

#### `/api/generate`

Handles press release generation.

Current behaviour:

- verifies the Supabase user from the bearer token
- requires a saved evaluation ID owned by the verified user
- generates press release draft
- blocks generation when evaluation verdict is `NO-GO`
- enforces the free generation limit from database-backed usage
- saves generations to Supabase

#### `/api/usage`

Returns database-backed usage state for the verified user.

Current behaviour:

- verifies the Supabase user from the bearer token
- counts saved rows in the `generations` table
- returns used, remaining, and limit values

---

## Frontend Features

Current frontend includes:

- structured announcement input
- context fields such as:
  - market
  - funding
  - partners
- verdict badge (`green / yellow / red`)
- journalist reaction and recommendation display
- primary failure modes and next actions
- generation gated by evaluation result
- GitHub and Google login via Supabase OAuth
- logout
- recent evaluation history
- saved generation loading for recent evaluations

---

## Technical Stack

- Next.js (Pages Router)
- React
- TypeScript
- OpenAI API
- Supabase auth and persistence
- local development via `npm run dev`

---

## Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/sealax/pr-copilot-mvp.git
cd pr-copilot-mvp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env.local`

Create a file called `.env.local` in the project root and add:

```env
OPENAI_API_KEY=your_openai_api_key
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
DEMO_USAGE_SALT=your_long_random_demo_usage_salt
```

Generate the demo salt with a cryptographically secure tool, for example:

```bash
openssl rand -hex 32
```

### 4. Apply Supabase migrations

Apply the SQL files in `supabase/migrations` to the configured Supabase project.
Anonymous demo mode requires the `demo_usage` table and its usage functions.

### 5. Start the local dev server

```bash
npm run dev
```

### 6. Open the app

```text
http://localhost:3000
```

---

## How to Run the MVP Again Later

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

If you changed `.env.local`, stop and restart the dev server.

---

## How to Test the MVP

### Evaluation flow

1. Enter an announcement in the structured form
2. Fill in the relevant context fields
3. Run **PR Readiness Evaluation**
4. Review:
   - verdict
   - primary failure modes
   - simulated journalist reaction
   - recommendation / next actions
   - saved recent evaluation history

### Generation flow

1. Complete evaluation first
2. If verdict is not `NO-GO`, click **Generate**
3. Review the generated press release draft
4. Confirm the saved draft can be reloaded from recent evaluations

---

## Current Product Logic

The MVP is intentionally opinionated.

### Core rule

Evaluation comes first.

### Generation rule

If verdict is `NO-GO`, generation is blocked.

### Product intent

The goal is not to flatter the user.  
The goal is to challenge weak announcements and reduce avoidable PR mistakes.

---

## Design Philosophy

PR Copilot is built around a simple product view:

- weak announcements should be challenged, not polished
- good PR starts with story quality, not just copy quality
- AI should help founders think better, not just write faster

That is why the product flow is:

**evaluate first → generate second**

not:

**generate instantly and hope for the best**

---

## Current Limitations

This is still an MVP.

Current limitations include:

- UI is still basic and mostly inline-styled
- history only fetches the latest 5 evaluations
- no schema validation library yet
- no lint script or automated tests yet
- no documented Supabase migrations or RLS policy setup in the repo yet
- no announcement-type prompt system yet
- limited product polish and dashboard sophistication
- no Stripe/payment logic yet

---

## Common Issues

### `npm` not recognised

Node.js is not installed properly, or is not available in your terminal path.

### App loads but API features fail

Check `.env.local` and restart the server.

### OpenAI quota or billing error

Your OpenAI billing, credit, or usage cap needs updating.

### Supabase auth issues

Check:

- project URL
- anon key
- provider settings
- redirect URLs

### Google OAuth setup

The app supports GitHub and Google login through Supabase OAuth. To enable Google login:

- Create OAuth credentials in Google Cloud Console.
- Add the Supabase callback URL from **Supabase Auth > Providers > Google** to the Google OAuth redirect URIs.
- Enable the Google provider in Supabase and add the Google client ID and client secret.
- Confirm local and production site URLs are allowed in Supabase Auth URL configuration.

### `.env.local` changes not taking effect

Restart the dev server:

```bash
Ctrl + C
npm run dev
```

---

## Suggested Next Steps

### Product

- document Supabase table schema and RLS policies
- tighten typed API contracts and evaluation schema definitions
- build prompt systems by announcement type
- refine positioning and onboarding copy

### UX / UI

- improve dashboard design
- improve output presentation
- improve saved history view
- add export / copy workflow
- improve premium feel and trust signals

### Engineering

- add a lint script and minimal automated tests
- remove dead frontend parsing helpers left over from text-based evaluation output
- keep `npm run build` passing before deploy

### Business

- sharpen positioning against “just use ChatGPT”
- test with real founders and PR users
- validate willingness to pay
- add pricing / upgrade path

---

## Positioning

PR Copilot is not trying to compete as a general writing assistant.

It is trying to win on:

- PR-specific decision support
- structured readiness assessment
- challenge and critique
- faster founder-side comms execution
- reduced dependence on agencies for first-pass work

---

## Repo Purpose

This repository is the working codebase for the PR Copilot MVP.

It exists to:

- test the core product logic
- validate the evaluate-then-generate workflow
- prove the concept before billing and production polish are added
