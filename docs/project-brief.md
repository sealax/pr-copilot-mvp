---

### `docs/project-brief.md`

```md
# PR Copilot Project Brief

## What this product is

PR Copilot is an MVP that helps founders assess whether an announcement is actually ready for proactive PR.

It is designed to challenge weak announcements before they reach journalists, rather than simply generating polished but unconvincing copy.

This product is meant to sit in the gap between:
- founders who want coverage
- weak or unproven announcements
- and generic AI writing tools that make poor inputs sound better without improving their underlying substance

## Core value proposition

PR Copilot helps founders validate and de-risk serious market entry announcements before speaking to media.

## Current product logic

### Step 1: Readiness evaluation

Users enter announcement details and context.

The system evaluates the announcement and returns a structured result including:
- verdict
- overall risk score
- risk breakdown
- likely journalist reaction
- primary failure modes
- recommendation
- next actions

### Step 2: Generation

If the announcement is sufficiently viable, the user can generate a draft press release.

If the evaluation result is too weak, generation should be blocked or clearly discouraged.

## Why this matters

The app should not behave like a generic AI writing assistant.

Its value comes from:
- judgment
- structured critique
- forcing better inputs
- preserving credibility

If the product simply generates copy from any input, it loses its wedge.

## Current architecture

### Frontend
- Next.js Pages Router
- React
- TypeScript

### Backend/API
- `/api/evaluate`
- `/api/generate`

### Services
- OpenAI for evaluation and generation
- Supabase for auth/data where applicable

## Known product principles

- evaluation must come before generation
- structured output is more useful than vague narrative output
- risk should be visible, not hidden
- the system should feel rigorous, not gimmicky
- product clarity matters more than flashy features at MVP stage

## Current UX expectations

The main screen should support:
- announcement/context input
- running a readiness check
- seeing verdict and risk
- optionally generating a press release only after evaluation

Useful interface elements:
- verdict badge
- overall score
- risk breakdown
- collapsible evaluation details
- generation controls tied to evaluation state

## Current state of the project

The project is an MVP and not a full production platform.

The aim is to create a stable, credible demo that shows:
- product thinking
- working AI integration
- a strong evaluation-first workflow
- a more serious alternative to “press release + ChatGPT”

## What success looks like right now

Success for the next phase is not “build everything”.

Success is:
- a clean, stable demo
- clear product logic
- good UX around the evaluation flow
- a working generate flow with proper gating
- enough polish to show employers, users, or early testers

## Near-term engineering priorities

1. Stabilise evaluation and generation state flow
2. Improve UI clarity around verdict and next actions
3. Make outputs feel structured and credible
4. Tighten typing and validation
5. Add only the minimum persistence/auth needed for the demo
6. Keep deployment stable

## Likely next tasks

Examples of sensible next tasks:
- improve state handling after evaluation
- make generation gating more robust
- refine the output schema and rendering
- improve empty/loading/error states
- add evaluation history or saved sessions
- tighten prompt structure without changing product logic
- improve demo-readiness of the homepage/UI

## Out of scope for now

Avoid spending time on these unless explicitly prioritised:
- complex multi-user collaboration
- over-engineered role systems
- elaborate analytics
- broad CMS features
- full agency workflow software
- large-scale infrastructure changes
- premature enterprise features

## Technical constraints

- preserve existing working build behaviour
- do not hardcode secrets
- keep environment variable usage clean
- keep changes small and explainable
- validate behaviour in code, not assumptions

## Working style for AI coding agents

When an AI coding agent works on this repo, it should:
- inspect relevant files before editing
- explain current behaviour
- propose a scoped change
- implement the change
- run build/lint/tests if available
- report what changed and any unresolved issues

## Acceptance criteria for most tasks

Unless a task says otherwise, changes should:
- preserve evaluation-first logic
- avoid regressions in generation gating
- keep output structured and understandable
- maintain or improve build stability
- improve clarity, maintainability, or UX
