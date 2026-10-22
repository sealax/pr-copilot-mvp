# Beta API cost protection

## Scope and allowances

The approved compatibility baseline is main 049eb7a. Core-table definitions and
permissions were supplied by the project owner; production was not queried or changed.
Browser code uses Supabase only for authentication; table reads/writes are server-side.

| Identity | Lifetime evaluations | Lifetime drafts |
| --- | --- | --- |
| Anonymous IP hash | 2 | 1 |
| Authenticated free account | 5 | 5 |
| Admin allowlist | No lifetime cap | No lifetime cap |

All identities, including admins, have one active request at a time, up to 10
reservation attempts for evaluation and 5 for generation per fixed database minute,
and a shared network ceiling of 30 reservations/minute. Released reservations still
count toward these throttles. Invalid input and failed generation-integrity gates
cannot reach OpenAI.

The shared daily ceiling starts at 200 and is authoritative in the singleton
api_usage_config database row. Dispatch accepts no limit argument. Only the database
owner (or an equivalently privileged administrator) may change it through privileged SQL, for example:
`UPDATE public.api_usage_config SET daily_attempt_limit = 200 WHERE singleton;`
Browser and service roles cannot read or modify this configuration. Changing it
requires an explicit administrative database operation; no application environment
variable can raise the ceiling. The UTC-day counter covers every scope in this database.

Vercel requires VERCEL=1 and a valid VERCEL_ENV (production/preview/development).
Outside Vercel, only non-production local execution can use development scope;
missing or invalid production configuration fails closed before a paid call.
Production quota seeds are not copied to other
scopes. Scope separation does NOT isolate the existing history tables: previews
must use an isolated test database. Use a separate test API project/key if test and
production databases are separate; their counters cannot bound spending on a shared
key across different databases or unrelated applications.

## Migration and existing data

202610220001_api_cost_protection.sql adds four server-only tables:

- api_usage_accounts: committed allowances and per-account minute counters.
- api_usage_reservations: request identity/state/expiry/result ID, no announcement text.
- api_usage_buckets: shared IP-minute and global-day counters.
- api_usage_config: owner-only singleton daily ceiling, initially 200.

Accounts are initialized lazily under locking. Existing authenticated evaluations
are NOT counted: every existing account starts with five beta evaluations. Existing
production generations, INCLUDING imported drafts, initialize draft usage. Existing
production demo_usage counters initialize anonymous usage. Existing history/output
rows are not deleted, rewritten or backfilled. Initializing an account is idempotent.

Signed anonymous evaluations do not debit authenticated evaluation quota during
import. Importing a signed draft still debits draft allowance once, in the same
transaction as its insertion. Imports serialize with usage operations and retry
safely. Importing history is allowed even when no draft allowance remains; it can
raise used drafts above five but does not authorize another paid call. An already
reserved request retains its slot if a draft import concurrently consumes the last
unreserved allowance.

RLS is explicitly enabled on all four new tables. No browser policies or grants are
added. Browser/public privileges are revoked on the core tables and demo_usage,
including TRUNCATE (which is not protected by RLS). Server routes retain core-table
SELECT/INSERT. Only service_role receives execution on the public usage/import
RPCs; internal helpers are owner-only, with explicit service_role revocation even
when hosted default grants include that role. The existing rls_auto_enable event trigger
is not modified. The legacy demo counter functions remain for a compatible schema
rollout but are no longer called by the new routes.

## Request state and failure behavior

1. Authenticate, validate all inputs and enforce the existing generation gate.
2. Reserve quota under the account lock. A partial unique index is a second guard
   against simultaneous active reservations.
3. Atomically authorize dispatch and increment the shared daily attempt bucket.
   Dispatch is allowed only once per reservation and uses the current UTC day.
4. Call gpt-4o-mini with no SDK retries, a 25-second SDK timeout, completion caps of
   2,000 tokens (evaluation) and 1,500 (draft), and a 64,000-byte aggregate prompt cap.
5. Reject non-stop finish reasons, empty output, invalid JSON and incomplete assessment
   structure. Existing numeric clamping remains intact.
6. Complete the reservation. Authenticated result insertion, allowance debit and
   reservation completion are one SQL transaction. Anonymous assessments/drafts
   retain the existing browser-held signed-result workflow; only accounting is
   finalized server-side. Success is returned only after finalization succeeds.

Failures release user quota idempotently BEFORE returning an error response.
Dispatched global attempts are NEVER refunded, even when output is unusable or a
network timeout leaves billing uncertain. Dispatch authorization can conservatively
count an attempt even if the process dies immediately before the actual HTTP call.

Reservations expire after 90 seconds (longer than the 45-second route limit). Usage
reads and subsequent reservations expire stale active rows under the account lock.
Late completion is rejected; completed rows cannot be refunded or completed twice.
If release fails, the reservation remains held until expiry. Ambiguous finalization
is safe: release cannot reverse a transaction that already completed successfully.
Terminal reservations and buckets are retained for diagnosis; add a reviewed
retention cleanup later if growth warrants it. No scheduled infrastructure is needed
for correctness or reservation recovery.

RPC clients have a four-second abort deadline and SQL lock acquisition has a
three-second timeout. API evaluate/generate explicitly export maxDuration: 45,
supported by the installed Next.js 13.5.6 Pages Router build configuration. The owner
reported a Vercel maximum of 300 seconds; verify the deployed 45-second setting in
preview before rollout. Client/SDK cancellation cannot guarantee provider-side
cancellation or zero billing; the daily count and token cap remain the safeguards.

## Automated verification

```sh
node --test tests/secure-generation.test.cjs tests/api-cost-protection.test.cjs
node --test tests/api-cost-protection.sql.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
NEXT_TELEMETRY_DISABLED=1 npm run build
```

The SQL suite starts and deletes its OWN temporary PostgreSQL cluster, using Unix
sockets only. It never reads DATABASE_URL or connects to an existing cluster.
Provide TEST_POSTGRES_BIN pointing to an installed server bin directory if necessary.
It skips when PostgreSQL server binaries are unavailable; a skip is NOT SQL validation.
All OpenAI calls are mocked. Actual PostgreSQL tests cover independent-connection
races, permissions, backfill policy, global limits, expiry, idempotency, imported
usage, persistence rollback and canonical drafting checks.

## Required rollout (NOT performed)

1. Review the migration and supplied schema/grant baseline; test it against an
   isolated Supabase project, including real PostgREST RPC responses and Supabase
   authentication. The local SQL fixture reproduces the supplied core schema; it
   does not recreate all hosted Supabase event triggers or surrounding objects.
2. Verify existing-generation/demonstration counts before cutover; keep the salt
   stable. Review any external integrations that rely on browser-role table grants.
3. Pause paid API traffic and drain old in-flight requests before initializing new
   production accounting. Protect historical deployment URLs and API aliases.
   Apply the additive migration through the approved database release process.
   Never apply production changes as part of local tests.
4. Deploy the new routes only after their RPCs exist; missing RPCs fail closed.
   Coordinate cutover and drain old in-flight work. Old deployments/routes bypass
   the new accounting and must be protected or retired before public beta. Rolling
   application code back to the old version also removes cost enforcement.
5. Verify the owner-controlled database daily limit (initially 200). No daily-limit
   environment variable is used. Confirm the 45-second function duration in the preview deployment.
6. Manually verify fresh/exhausted account and demo balances, admin safety limits,
   model failure recovery, and Google OAuth -> signed NO-GO import -> history refresh.
   Check imported-draft balance refresh and mobile allowance messages.

No production migration, configuration change, deployment, commit or push is included
in this implementation task.
