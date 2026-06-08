# PR Copilot SaaS Redesign Project Plan

## Objective

Transform PR Copilot from a functional MVP into a product that feels credible, premium and commercially valuable before further feature development.

Success criteria:

- Looks like a real SaaS product
- Can be confidently shared with founders
- Clearly explains its value proposition
- Makes users understand what to do immediately
- Preserves all existing functionality
- Supports future paid plans

---

# Global Instructions For Every Branch

Before starting work:

1. Create the specified branch from main
2. Only complete the tasks for that branch
3. Do not make unrelated changes
4. Preserve:
   - Supabase authentication
   - OpenAI integrations
   - Usage limits
   - Existing API routes
   - Existing database structure
5. Run build checks before finishing
6. Commit all changes
7. Provide:
   - Files changed
   - Components added
   - Screenshots if available
   - Any issues found

Do not merge automatically.

Wait for review before proceeding.

---

# Branch 1

Branch name:

design-system-foundation

Goal:

Create a premium visual foundation across the entire application.

Tasks:

- Establish colour palette
- Establish typography scale
- Improve spacing system
- Improve button styling
- Improve card styling
- Improve form styling
- Improve page container widths
- Improve navigation styling
- Create reusable UI patterns

Suggested components:

- Header
- PageContainer
- Card
- PrimaryButton
- SecondaryButton

Requirements:

- Light theme
- Editorial feel
- Apple-inspired SaaS aesthetic
- Lots of whitespace
- Minimal visual clutter

Definition of done:

- Entire application looks noticeably more premium
- Existing functionality unchanged
- Design system reusable for later branches

Review checkpoint:

Would this pass as a funded startup rather than a bootcamp project?

---

# Branch 2

Branch name:

landing-page-redesign

Goal:

Build a proper marketing homepage.

Tasks:

Create:

## Hero section

Headline:

PR Copilot helps founders and comms teams test whether a story is newsworthy, improve the angle, and generate press-ready pitches.

Include:

- Primary CTA
- Secondary CTA
- Supporting copy

## Feature section

Feature cards explaining:

- PR readiness evaluation
- Media angle generation
- Pitch drafting
- Next-action recommendations

## Social proof section

Placeholder for:

- Testimonials
- Founder quotes
- Usage metrics

## FAQ section

Address:

- Who is it for?
- Why not use ChatGPT?
- Do I need PR experience?
- How many pitches can I generate?

Definition of done:

Homepage feels like a commercial SaaS product.

Review checkpoint:

Would a founder understand the product in 10 seconds?

---

# Branch 3

Branch name:

pricing-and-positioning

Goal:

Clarify commercial value and differentiation.

Tasks:

Create:

## Pricing section

Free

- £0
- 5 evaluations
- Basic pitch generation

Pro

- £29/month
- Unlimited evaluations
- Advanced recommendations
- Saved history

Team

- £79/month
- Multiple users
- Shared campaigns
- Team workspace

Visual only.

No Stripe.

No payment integration.

---

## Why Not Just Use ChatGPT?

Create dedicated section explaining:

- ChatGPT is general purpose
- PR Copilot uses structured PR workflows
- Users do not need prompt engineering
- Outputs include editorial judgement
- Users receive actionable recommendations

Definition of done:

A visitor immediately understands why this exists.

Review checkpoint:

Could someone still dismiss this as "just ChatGPT"?

If yes, redesign.

---

# Branch 4

Branch name:

dashboard-experience

Goal:

Transform the logged-in area into a professional workspace.

Tasks:

Create:

## Dashboard layout

Include:

- Sidebar or premium top navigation
- Workspace structure
- Consistent card layouts

## Usage meter

Display:

"X of 5 free evaluations used"

## Input workspace

Improve:

- Announcement input
- Evaluation flow
- CTA hierarchy

## Output workspace

Improve presentation of:

- Verdict
- Scores
- Journalist reaction
- Next actions
- Generated draft

## States

Design:

- Empty state
- Loading state
- Error state

## Upgrade prompts

Add tasteful:

"Upgrade to Pro"

placement.

Definition of done:

Dashboard feels like software people pay for.

Review checkpoint:

Does it look like a professional PR workspace?

---

# Branch 5

Branch name:

onboarding-and-example-outputs

Goal:

Reduce friction for first-time users.

Tasks:

Create:

## Onboarding panel

Three-step explanation:

1. Describe your announcement
2. Get a PR readiness verdict
3. Generate a press-ready pitch

## Example prompts

Examples:

- We raised a £2m seed round for our AI compliance startup
- We are launching a new crypto wallet for institutional users
- We are announcing a partnership with a major fintech platform

## Example outputs section

Show realistic examples:

### PR Readiness Verdict

GO / CONDITIONAL GO / NO GO

### Suggested Media Angle

Example angle

### Journalist Reaction

Example commentary

### Recommended Actions

Example recommendations

### Generated Pitch

Example output

Definition of done:

A new user understands exactly what the product does without guessing.

Review checkpoint:

Could a user successfully use the product without reading instructions?

---

# Final Review

After all branches are merged:

Checklist:

✓ Premium visual design

✓ Clear positioning

✓ Pricing visible

✓ Example outputs visible

✓ Better onboarding

✓ Dashboard feels commercial

✓ ChatGPT objection addressed

✓ Login still works

✓ OpenAI generation still works

✓ Usage limits still work

✓ App builds successfully

Only after completing this phase should further feature development be considered.
