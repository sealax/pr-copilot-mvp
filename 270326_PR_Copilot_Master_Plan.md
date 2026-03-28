# PR Copilot — Master Plan (Deploy → Persistence → Product)

## 0. Objective (Non-negotiable)
Ship a live, credible demo that proves:
- You can deploy a full-stack AI app
- You can handle auth + env + APIs
- You can structure a real product workflow

NOT the goal:
- Polished SaaS
- Full feature set
- Perfect UX

---

## 1. Current State (Reality Check)
Working:
- Next.js app (local)
- Evaluation endpoint (/api/evaluate)
- Generation endpoint (/api/generate)
- Structured scoring system (key asset)

Broken / fragile:
- Supabase auth unreliable (recent fixes)
- No persistence (stateless)
- No production deployment
- No user tracking / saved outputs

Conclusion:
You have a **strong core mechanic (evaluation engine)** but **zero product infrastructure**.

---

## 2. Phase 1 — Deploy (Immediate Priority)

### Goal:
Live URL that works consistently

### Actions:
- Deploy via Vercel (GitHub import)
- Add env vars:
  - OPENAI_API_KEY
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY
  - SUPABASE_SERVICE_ROLE_KEY

### Strip before deploy:
- Disable fragile auth if needed
- Hide generation behind message:
  “Generation is experimental in this demo”

### Add:
- Simple headline:
  “AI tool to assess PR readiness before media outreach”
- One working example input

### Output:
Live demo that works without breaking

---

## 3. Phase 2 — Persistence (Critical Next Step)

Right now your app is disposable. That kills real value.

### Goal:
Save evaluations + results

### Minimum viable schema (Supabase):

Table: evaluations
- id (uuid)
- created_at (timestamp)
- market (text)
- partners (text)
- funding (text)
- verdict (text)
- score (int)
- breakdown (jsonb)
- output (jsonb)

### Actions:
- On evaluate → INSERT row
- On page load → FETCH recent evaluations
- Display simple history list

### Do NOT overbuild:
No dashboards
No analytics
No complexity

Just:
“User runs → result saved → can see past runs”

---

## 4. Phase 3 — Core Product Tightening

### Problem:
Right now it's a toy. You need to make it feel like a tool.

### Improve:
- Input structure (force better inputs)
- Output clarity (more decisive language)
- Add:
  - “Why this matters”
  - “What to fix next”

### Add 1 killer feature:
“Rewrite input to make it PR-ready”

That’s your wedge.

---

## 5. Phase 4 — UX / Design (Keep it tight)

### Fix:
- Layout spacing
- Typography hierarchy
- Remove clutter

### Add:
- Clear sections:
  - Input
  - Verdict
  - Breakdown
  - Actions

### Do NOT:
- Overdesign
- Add animations
- Add complexity

Goal:
Serious tool, not a playground

---

## 6. Phase 5 — Differentiation (Critical thinking)

Your risk:
“This is just ChatGPT with a form”

You need:
- Structured scoring (already good)
- Opinionated output (stronger)
- Real-world framing (journalist lens)

### Improve:
- Add “Journalist reaction” (you already started this — good)
- Add “Would this get coverage?” binary output

Push it harder.

---

## 7. Phase 6 — Real Validation (This matters more than code)

Your product currently fails here:
- No real users
- No real outputs used in market

### Fix:
- Get 1 founder to use it
- Capture:
  - Before / after
  - Result quality
- Add:
  “Used by X founder preparing Y launch”

Without this:
Your product is theory

---

## 8. Phase 7 — Optional Monetisation (Later)

Ignore for now, but directionally:

- Free:
  Evaluation
- Paid:
  - Rewrite
  - Full PR pack
  - Narrative strategy

But do NOT touch this yet.

---

## 9. What Actually Matters (Brutal truth)

The value is NOT:
- UI
- Auth
- Features

The value is:
- Your scoring system
- Your PR judgment
- Your ability to say “this will fail”

Everything else is plumbing.

---

## 10. Next Immediate Step

Do NOT jump ahead.

Next step only:
👉 Deploy on Vercel and get a working public URL

Once that is done:
We move to persistence ONLY

No feature creep.
