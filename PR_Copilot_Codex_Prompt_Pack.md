# PR Copilot — Codex Prompt Pack

## Purpose

These prompts are designed to help Codex:
- understand the repo properly
- avoid chaotic refactors
- preserve the evaluation-first architecture
- make small, controlled improvements
- behave like a disciplined engineering assistant instead of a code generator

Use these prompts inside the PR Copilot repo after Codex has read:
- `AGENTS.md`
- `docs/project-brief.md`

---

# 1. Full repo analysis (no edits)

```text
Read AGENTS.md and docs/project-brief.md first.

Then inspect this entire repository and explain:

1. The current application architecture
2. The frontend rendering flow
3. How evaluation state is stored and passed through the UI
4. How generation is currently gated
5. The weakest implementation area in the codebase
6. The highest-risk file if edited incorrectly
7. The 3 most important technical improvements to make next

Do not make changes yet.
```

---

# 2. Detect weak generation gating

```text
Read AGENTS.md and docs/project-brief.md.

Inspect the evaluation and generation flow.

Determine whether a user could bypass the intended evaluation-first workflow and still generate a press release.

Check:
- frontend state gating
- API route protections
- direct endpoint access risks
- missing validation
- client-side-only enforcement

Explain all weaknesses clearly before making changes.

Do not edit files yet.
```

---

# 3. Safe implementation task

```text
Read AGENTS.md and docs/project-brief.md.

Implement the smallest possible improvement to strengthen generation gating.

Requirements:
- preserve current UX
- avoid broad refactors
- minimise changed files
- explain every file before editing
- run build after implementation
- report exactly what changed
```

---

# 4. UI clarity review

```text
Read AGENTS.md and docs/project-brief.md.

Inspect the frontend UI and evaluate whether the product clearly communicates:
- evaluation before generation
- verdict visibility
- risk visibility
- seriousness/credibility
- next actions

Identify:
- confusing UX
- generic AI-app behaviour
- clutter
- weak hierarchy
- unclear messaging

Rank the top 5 UI improvements by impact.

Do not edit files yet.
```

---

# 5. Small UX improvement implementation

```text
Read AGENTS.md and docs/project-brief.md.

Implement ONE high-impact UI clarity improvement only.

Constraints:
- small diff
- preserve current architecture
- no redesign
- no dependency changes unless absolutely necessary
- maintain evaluation-first workflow visibility

Explain:
- why this change was chosen
- what files changed
- how the UX improved
```

---

# 6. Refactor review without rewriting the app

```text
Read AGENTS.md and docs/project-brief.md.

Inspect the codebase for:
- duplicated logic
- fragile state handling
- unnecessary complexity
- weak typing
- dead code
- risky coupling

Prioritise only improvements that:
- reduce maintenance risk
- improve readability
- preserve existing behaviour

Do not suggest large rewrites.

Provide:
1. issue
2. impact
3. smallest sensible fix
```

---

# 7. State management audit

```text
Read AGENTS.md and docs/project-brief.md.

Inspect all frontend state related to:
- evaluation results
- verdict handling
- loading states
- generation eligibility
- error handling

Explain:
- where state transitions are fragile
- where race conditions or stale state could occur
- where user actions could produce inconsistent UI

Suggest only small stabilisation improvements.

Do not edit files yet.
```

---

# 8. Prompt engineering review

```text
Read AGENTS.md and docs/project-brief.md.

Inspect the OpenAI prompts and API usage patterns.

Evaluate:
- whether prompts reinforce evaluation-first logic
- whether outputs are structured consistently
- whether prompts drift toward generic PR generation
- whether schema consistency could break
- whether hallucination risk is handled well

Suggest improvements that:
- improve consistency
- improve credibility
- preserve current architecture
- avoid over-engineering
```

---

# 9. Demo readiness review

```text
Read AGENTS.md and docs/project-brief.md.

Evaluate whether this project is strong enough for:
- portfolio demonstration
- recruiter review
- hiring manager walkthrough
- technical interview discussion

Assess:
- architecture credibility
- UX quality
- implementation quality
- product clarity
- obvious weaknesses
- demo-breaking risks

Then recommend:
1. the single highest-value improvement
2. the single biggest credibility risk
3. what should NOT be worked on yet
```

---

# 10. Controlled feature implementation

```text
Read AGENTS.md and docs/project-brief.md.

I want to add this feature:

[INSERT FEATURE HERE]

Before implementing:
1. explain how it fits the existing architecture
2. identify risks
3. identify affected files
4. propose the smallest implementation path

Then:
- implement carefully
- avoid unrelated edits
- preserve evaluation-first workflow
- run build afterwards
- summarise exact changes
```

---

# Recommended workflow

For most tasks:

1. Ask Codex to analyse first
2. Review its understanding carefully
3. Approve only scoped changes
4. Inspect diffs manually
5. Run build/lint
6. Commit frequently

Do not:
- ask for massive rewrites
- allow broad uncontrolled edits
- merge unreviewed changes
- let Codex invent architecture without verification

The goal is leverage, not chaos.
