# Secure generation

Authenticated generation loads the owned evaluation, accepts only GO/CONDITIONAL,
rejects a changed announcement (after trimming), and uses the database announcement
for both the model request and generation record. Admin status does not bypass this gate.

Anonymous evaluations now issue a server-generated import ID and a signed receipt
covering the announcement, saved context, normalized evaluation and issuance timestamp.
The browser preserves the server result unchanged through OAuth. Import verifies its
signature, seven-day expiry and all supplied assessment fields before saving. Receipts
are portable across IP changes; anonymous drafting still requires the existing IP-bound,
one-hour evaluation token as well. Draft output has a separate receipt bound to its
assessment receipt, so client-written text cannot be imported as a generated draft.

No database migration or new environment variable is required. The existing
DEMO_USAGE_SALT signs receipts; keep it stable and secret. Rotating it invalidates
existing receipts. Proof is stored in evaluation_json.evaluationReceipt. Saved imports
remain usable after the import window closes, but their signatures are checked whenever
they authorise drafting. Existing unsigned imported records and pre-change pending
results require reassessment; their saved history/drafts are not deleted.

The UI invalidates eligibility and clears stale output after briefing edits. Responses
for an older briefing/selection are ignored. Styling and layout are unchanged.

## Verification

Run with existing dependencies (no paid calls or live database writes):

```sh
node --test tests/secure-generation.test.cjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run build
```

Tests compile TypeScript in memory, replace OpenAI/Supabase, and exercise real API
handlers. Frontend handler tests use a small hook/element harness; they are not browser
or OAuth integration tests.

Before release, manually verify Google OAuth, anonymous assessment/draft import,
refresh/history, copying, and edits during pending requests. Verify the live database
prevents browser credentials from inserting or modifying authoritative evaluations
(including source, verdict, announcement and provenance). Core-table grants/RLS are
not defined in this repository and were not inspected against live services. Existing
trusted authenticated records remain trusted; this change does not establish or
repair database policies or attest historical records.

Usage reservation, distributed throttling and broader pre-launch audit findings are
outside this branch.
