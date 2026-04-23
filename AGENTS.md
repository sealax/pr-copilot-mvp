# AGENTS.md

## Project overview

PR Copilot is an AI-powered PR readiness and press release generation MVP.

Its purpose is not to blindly generate PR copy. It is designed to help founders validate and de-risk serious market entry announcements before speaking to media.

The core product principle is:

- evaluation comes before generation
- weak announcements should be challenged, not polished
- the app should behave more like a critical PR operator than a generic content generator

## Current stack

- Next.js (Pages Router)
- React
- TypeScript
- OpenAI API
- Supabase

## Core architecture

There are two primary backend flows:

1. `/api/evaluate`
   - accepts announcement context
   - returns a structured evaluation in JSON
   - includes verdict, risk score, risk breakdown, journalist reaction, failure modes, and next actions
   - server-side validation/clamping must be preserved

2. `/api/generate`
   - generates a press release draft
   - must be gated by the evaluation result
   - must not allow generation when verdict is `NO-GO`

Frontend should clearly reflect that evaluation is the first-class workflow and generation is secondary.

## Product rules that must not be broken

- Do not turn this into a generic “AI press release writer”
- Do not bypass the evaluation-first architecture
- Do not remove the generation gate tied to evaluation verdict/state
- Do not weaken or flatten the structured evaluation output into vague prose
- Do not replace nuanced verdict logic with a simplistic pass/fail flow
- Do not remove or obscure the risk breakdown
- Do not introduce fake production claims or misleading UX language

## Evaluation model expectations

The evaluation result should remain structured and consistent.

Expected concepts include:

- `verdict`: `GO`, `CONDITIONAL`, or `NO-GO`
- `overallRiskScore`: numeric, clamped safely
- `riskBreakdown`: structured dimensions
- `primaryFailureModes`
- `journalistReaction`
- `recommendation`
- `nextActions`

If schema changes are proposed, preserve backwards compatibility unless explicitly asked to refactor the full flow.

## UX priorities

The UI should make it obvious that:

- users are submitting an announcement for readiness assessment
- the system returns a verdict and risk view first
- only then can they generate a draft if appropriate

Useful UI patterns:
- verdict badge
- clear risk score display
- visible risk breakdown
- collapsible detail sections
- disabled or blocked generation when evaluation is not sufficient

Avoid:
- clutter
- overly “magical” AI language
- burying the evaluation beneath the generation workflow

## Coding expectations

- Prefer small, readable changes
- Preserve existing working behaviour unless task requires change
- Keep TypeScript types explicit where useful
- Do not introduce unnecessary abstraction
- Do not rewrite large working sections without a clear reason
- Keep API route logic easy to inspect and debug
- Validate assumptions against the actual codebase before changing behaviour

## Commands

Install dependencies:
npm install

Run dev server:
npm run dev

Build:
npm run build

Lint if available:
npm run lint

Environment
Expected environment variables may include:

* OPENAI_API_KEY
* NEXT_PUBLIC_SUPABASE_URL
* NEXT_PUBLIC_SUPABASE_ANON_KEY
* SUPABASE_SERVICE_ROLE_KEY

Do not hardcode secrets.
Do not print secrets.
Do not commit .env.local.

How to work on this repo

When making changes:

1. inspect the relevant files first
2. explain the current behaviour briefly
3. propose the smallest sensible change
4. implement it
5. run build/lint/tests where available
6. report exactly what changed

For larger work:

* create a short plan before editing
* keep changes scoped
* avoid touching unrelated files

Definition of done

A task is only complete when:

* the requested behaviour is implemented
* existing core product logic is preserved
* the app still builds successfully
* no obvious UI or state regressions were introduced
* the change is explained clearly

Priority mindset

When in doubt, optimise for:

1. preserving the evaluation-first product logic
2. making the app clearer and more credible
3. maintaining stable buildable code
4. avoiding unnecessary complexity
