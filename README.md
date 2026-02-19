# PR Copilot (MVP)

PR Copilot is an AI-powered PR readiness and content generation tool.

## Core Concept

PR Copilot helps founders validate and de-risk serious market entry announcements before speaking to media.

It forces structured evaluation before content generation.

---

## Current Architecture (v1)

### 1. PR Readiness Evaluation
- `/api/evaluate`
- OpenAI-powered structured JSON output
- Server-side validation + clamping of scores
- Returns:
  - verdict (GO / CONDITIONAL / NO-GO)
  - overall risk score (0–100)
  - risk breakdown (5 dimensions)
  - primary failure modes
  - journalist reaction simulation
  - recommendation + next actions

Evaluation must run before generation.

---

### 2. Generation
- `/api/generate`
- Generates press release draft
- Blocked if verdict = NO-GO

---

### 3. Frontend (Next.js + React + TypeScript)
- Structured announcement input
- Context fields: market, funding, partners
- Verdict badge (green / yellow / red)
- Risk breakdown display
- Collapsible evaluation details
- Generation gated by evaluation

---

## Technical Stack

- Next.js (Pages Router)
- React (TSX)
- OpenAI API
- Supabase (auth + future persistence)
- Deployed locally via `npm run dev`

---

## Design Philosophy

This is not a generic AI writing tool.

It is:
- A decision engine first
- A content generator second
- Structured
- Opinionated
- Designed to challenge weak announcements

---

## Next Steps

- Persist evaluation + generation history (Supabase)
- Real auth + server-side usage limits
- Prompt systematisation by announcement type
- Positioning refinement