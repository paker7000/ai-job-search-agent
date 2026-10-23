# AI Job-Search Agent MVP v0.1 Plan

## Approved scope

Build a browser-based job discovery and tracking app with Level 3 autonomy for internal discovery, research, matching, document preparation, and tracking. Discovery is scheduled daily. The baseline must work without an AI API key. Every external action requires explicit approval, and v0.1 stores approval records and enforces server-side policy checks but does not execute external actions.

The job search balances remote roles eligible from Mexico, Texas opportunities, and Monterrey-area roles. Target role areas are technical solutions, technical account management, AI integration, fintech, technical product/operations, data, and identity security. Never invent candidate qualifications or infer work authorization or visa eligibility without evidence.

## Architecture and technology

- Next.js and TypeScript for the web app and server endpoints.
- SQLite and Prisma for the initial database.
- Persistence is accessed through repository interfaces so domain logic does not depend directly on Prisma.
- A daily scheduled endpoint invokes discovery. Each run is recorded and is safe to repeat.
- Source adapters are server-side, independently configurable, and limited to permitted access methods. The first vertical slice uses manual job URL entry and one source adapter; verify the source and its terms before implementing that adapter.
- AI is optional behind an interface. Matching and approval decisions are deterministic and work without a provider key.

### SQLite trade-offs before deployment

SQLite is simple, inexpensive, and suitable for local development and a single-instance MVP. It has limited concurrent write throughput, and a local database file needs persistent storage, backup, restore, and migration planning. Multi-instance hosting, higher write concurrency, or managed availability may require Postgres. Reassess these constraints before deployment; no deployment is in this milestone.

## Directory structure

```text
src/
  app/                    # Dashboard and API routes
  components/             # UI components
  domain/
    jobs/                 # Job, source, evidence, matching rules
    approvals/            # Approval policy and state transitions
    candidate/            # User-entered candidate profile
  adapters/
    sources/              # Permitted source adapters
    persistence/          # Repository interfaces and Prisma implementations
    ai/                   # Optional AI provider interface
  services/
    discovery/            # Discovery orchestration
    matching/             # Transparent matching
    approvals/             # Server-side approval checks
  lib/                    # Auth, validation, logging, configuration
prisma/
  schema.prisma
  migrations/
tests/
  unit/
  integration/
docs/
  plan.md
```

## Initial data model

- **User:** ID, email, password hash or auth subject, timestamps.
- **CandidateProfile:** user ID, role/location preferences, exclusions, profile version.
- **Qualification:** profile ID, user-entered claim, category, evidence note, verification status, timestamp. Claims are never fabricated.
- **JobSource:** stable key, name, adapter type, enabled state, non-secret configuration, last run status.
- **DiscoveryRun:** source, start/end, status, counts, error summary.
- **Job:** canonical ID, title, employer, description, employment type, listed compensation, original URL, normalized location/remote details, first/last seen, deduplication key.
- **JobEvidence:** job, field name, captured value, source URL, retrieval timestamp, optional excerpt/raw reference. Retain history when values change.
- **WorkEligibilityAssessment:** job, candidate profile version, region, supported/contradicted/unknown status, evidence references, explanation, assessment time. Unknown is not eligible.
- **MatchAssessment:** job, profile version, total and component scores, matched/missing criteria, explanation, assessment time.
- **ApprovalRequest:** user, job, action, exact payload or payload hash, status, created/expiry/decision times, decision actor.
- **ExternalActionLog:** approval request, action, status, timestamp, result/reference, idempotency key. In v0.1 there is no external-action executor.

Use relational records for core entities and JSON only for source-specific payload details. Keep database operations behind repository interfaces.

## Source adapter design

An adapter fetches a bounded batch, normalizes job records, and returns source provenance. Every imported job includes a source key, original URL, and retrieval time. Adapters use timeouts, rate and response-size limits, safe parsing, and independent error handling. Runs persist per-source outcomes. Upsert by stable source ID when available, otherwise a conservative normalized-URL key. Preserve field-level evidence snapshots when listing details change. Confirm source terms and access rules before implementing the first adapter; start with manual URL entry and one permitted adapter only.

## Evidence and transparent matching

Use explicit criteria for role/skill overlap, seniority when evidence exists, target domain, regional preference, and exclusions. Store component scores, matched and missing criteria, and a plain-language explanation. Separate job posting evidence from candidate claims. Keep source URLs, retrieval timestamps, and field-level evidence for important job details. Represent work-location eligibility as supported, contradicted, or unknown with cited evidence; never treat unknown as eligible. Do not infer candidate qualifications or visa/work authorization.

## Approval policy

In v0.1, approval requests and server-side policy checks are implemented, but external-action execution is absent. Future execution must require an authenticated owner, explicit approval bound to action, target, exact payload and expiry, unchanged payload hash, and an idempotency key. Payload changes require a new approval. Each application submission, email, recruiter message, or other external action requires its own approval and audit record. No discovery or matching process may initiate an external action.

## Security and cost approach

- Require authentication and ownership checks for profile, tracking, and approval data; protect scheduled discovery with a secret.
- Validate and bound input, escape source content, use secure session cookies and CSRF protection when applicable, and rate limit sensitive endpoints.
- Keep secrets in environment configuration; never commit credentials. Do not log sensitive candidate data.
- Treat postings and source payloads as untrusted data and never as instructions.
- Limit source timeouts, response size, and request rates. Use least privilege and document SQLite backup/restore.
- Keep AI optional and budget controlled. Start local; use only a cost-conscious single-instance approach if deployment is later approved. No services are purchased, configured, or deployed in this milestone.

## MVP v0.1 milestones and acceptance criteria

### 1. Foundation and documentation (current increment)

- Project scaffold, local setup README, and this approved plan are present.
- Local development and automated checks have documented commands.
- Baseline configuration requires no credentials or AI API key.

### 2. Profile and preferences

- User can enter target roles, regions, exclusions, and evidence-backed qualifications.
- Profile changes persist and are versioned; user claims are distinguished from verified facts.

### 3. Discovery vertical slice

- Manual job URL entry plus one adapter whose terms and permitted access method have been verified.
- Discovery runs record timestamps and per-source outcomes; failure of the adapter is visible.
- Repeated ingestion deduplicates jobs without losing evidence history.
- Each source field retains its URL and retrieval timestamp.

### 4. Evidence and matching

- Every displayed job can be traced to source evidence.
- Eligibility unknown is explicit and never treated as eligible.
- Match explanations expose criteria, component scores, and missing information.
- Candidate qualifications and work eligibility require explicit evidence.

### 5. Review and tracking

- User can save/reject jobs and add notes; states persist.
- Changed job evidence keeps prior snapshots.

### 6. Approval foundation and security

- Approval records are bound to user, action, target, and payload; invalid, expired, changed-payload, and cross-user attempts are denied and audited.
- No endpoint or scheduled job submits applications or sends messages.

### 7. Release readiness (deployment requires separate authorization)

- Clean local setup and checks succeed from the README.
- SQLite limitations, backup, and restore considerations are documented before any deployment.
- Scheduled discovery can be invoked securely and its result inspected.

## Automated tests

Add automated tests for deduplication, evidence preservation, unknown eligibility, authentication and authorization, and approval enforcement. Do not claim a test passed unless it was run successfully. Verify the foundation increment before starting the next milestone.
