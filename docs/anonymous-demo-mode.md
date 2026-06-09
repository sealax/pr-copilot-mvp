# PR Copilot – Anonymous Demo Mode

## Goal

Reduce friction for first-time users and improve product validation.

Allow visitors to test PR Copilot without creating an account.

Anonymous users should receive enough value to understand the product, while preserving incentives to create an account.

---

# Demo Allowance

Anonymous users receive:

- 2 PR Readiness Evaluations
- 1 Draft Generation

Anonymous users do not receive:

- Saved history
- Persistent records
- Export functionality
- Unlimited usage

After limits are exhausted, users should be prompted to create a free account.

---

# Existing Authenticated Flow

Do not modify existing authenticated behaviour.

Authenticated users should continue to have:

- Existing usage limits
- Saved evaluations
- Saved drafts
- Usage tracking
- History functionality

All existing authenticated functionality must remain intact.

---

# Technical Implementation

## 1. Create Anonymous Usage Tracking Table

Create a new Supabase table:

sql create table if not exists demo_usage (   id uuid primary key default gen_random_uuid(),   ip_hash text not null unique,   readiness_checks_used integer not null default 0,   drafts_used integer not null default 0,   created_at timestamptz default now(),   updated_at timestamptz default now() );

---

## 2. Identify Anonymous Visitors

For unauthenticated requests:

- Read the visitor IP address from request headers
- Hash the IP server-side
- Never store raw IP addresses
- Never expose IP information to the client

Use:

env DEMO_USAGE_SALT=<long-random-secret>

Hashing should use SHA-256 plus the salt.

Example:

ts sha256(ip + DEMO_USAGE_SALT)

---

## 3. Readiness Evaluation Limits

Anonymous users:

- Allow evaluation if readiness_checks_used < 2
- Increment readiness_checks_used after successful evaluation
- Block evaluation when readiness_checks_used >= 2

Return remaining allowance to frontend.

Example:

json {   "remainingChecks": 1,   "remainingDrafts": 1 }

---

## 4. Draft Generation Limits

Anonymous users:

- Allow draft generation if drafts_used < 1
- Require at least one completed readiness evaluation
- Increment drafts_used after successful generation
- Block generation when drafts_used >= 1

Return remaining allowance to frontend.

Example:

json {   "remainingChecks": 0,   "remainingDrafts": 0 }

---

## 5. API Behaviour

### Evaluation Endpoint

Anonymous users:

- Check demo_usage table
- Enforce maximum of 2 evaluations
- Return remaining allowance
- Do not save to authenticated history tables

Authenticated users:

- Existing behaviour unchanged

---

### Draft Endpoint

Anonymous users:

- Check demo_usage table
- Enforce maximum of 1 draft generation
- Require previous readiness evaluation
- Return remaining allowance
- Do not save to authenticated history tables

Authenticated users:

- Existing behaviour unchanged

---

# Frontend Changes

## Landing Page

Primary CTA:

text Try Free PR Check

Secondary CTA:

text Create Free Account

---

## Demo Banner

Before usage:

text Demo Mode  2 PR checks included 1 draft generation included

---

After first evaluation:

text Demo Mode  1 PR check remaining 1 draft generation remaining

---

After second evaluation:

text Demo Mode  0 PR checks remaining 1 draft generation remaining  Create a free account for more evaluations.

---

After draft generation:

text Demo Complete  Create a free account to continue using PR Copilot.

---

# Feature Gates

Anonymous users must not have access to:

- Saved history
- Saved drafts
- Export functionality

If they attempt access, show:

text Create a free account to save PR evaluations, generate additional drafts, and build a launch history.

---

# Sign-Up Prompt

When demo limits are reached:

text You've used your free demo.  Create a free account to:  ✓ Run additional PR readiness checks  ✓ Generate more drafts  ✓ Save your evaluations  ✓ Build a launch history  [Create Free Account]

---

# Security Requirements

Must enforce limits server-side.

Do not rely solely on:

- localStorage
- cookies
- frontend state

Frontend checks may be used for UX only.

Server-side validation is mandatory.

---

# Acceptance Criteria

## Anonymous Visitor

Can:

- Open site
- Run 2 PR readiness evaluations
- Generate 1 draft
- See remaining usage allowance

Cannot:

- Exceed limits
- Access saved history
- Export content
- Persist records

After limits are reached:

- Clear sign-up prompt displayed

---

## Authenticated User

Can:

- Log in normally
- Run existing workflow
- Save evaluations
- Save drafts
- Access history
- Use existing usage tracking

No regression in current functionality.

---

# Explicitly Out Of Scope

Do not:

- Redesign the application
- Add Stripe
- Change pricing
- Remove login
- Modify existing authenticated usage logic
- Store raw IP addresses
- Build a referral system
- Add paid plans

Focus exclusively on implementing anonymous demo mode.
