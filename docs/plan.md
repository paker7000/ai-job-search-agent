# AI Job-Search Agent MVP v0.1

## Mission and confirmed requirements

Local-first browser app for internal discovery, research, matching, document preparation, and application tracking. Search balances remote work explicitly eligible from Mexico, Texas opportunities, and Monterrey-area roles. Target families include solutions architecture/engineering, technical account and customer success, AI/API integration, technical product/operations, fintech, data platforms, and identity security. Daily discovery is supported through a protected endpoint. No application, email, recruiter message, or other external action occurs without per-action explicit user approval; v0.1 records approval decisions but does not execute external actions.

The initial profile is user-provided. All profile claims are candidate-reported and are not independently verified. Dates, institutions, qualifications, production ML engineering, advanced quantitative research, and work authorization are not filled in unless supplied as evidence. Unknown eligibility is never treated as eligible.

## Current implementation

- Next.js App Router and TypeScript; SQLite local database behind repository interfaces.
- Single-account first-run setup, password hashing, signed HTTP-only/SameSite cookies, and protected APIs.
- Editable seeded candidate profile with visible review flags.
- Manual HTTPS job URL entry and a Greenhouse Job Board API adapter. Manual URLs are stored as source evidence and never fetched.
- Configurable Greenhouse public-board token saved locally; importer bounds responses, times out, validates board token and posting URLs, and records run success/failure.
- Bearer-protected scheduled discovery route reuses the saved source and importer. A scheduler must be operated by the user.
- Job URL deduplication, field-level evidence history, deterministic component match scoring, explanations, and explicit supported/contradicted/unknown work-eligibility state.
- Job tracking states and notes.
- Editable template-generated cover letter and resume highlights drawn only from candidate profile text.
- Payload-bound, expiring approval records with audit events. No external-action executor or application submission endpoint exists.
- Editable search preferences, defaulting to Mexico, Monterrey area, and Texas, with profile-derived role terms and company-name suggestions grounded in profile mentions. Each location creates an independent query preview; source fan-out and destination links are separate stages.
- Ten search destinations: LinkedIn Jobs, Indeed, Glassdoor, OCC Mundial, Wellfound, Remote OK, Remotive, We Work Remotely, Remote.co, and Working Nomads. LinkedIn/Indeed/Glassdoor direct links are prefilled where known; other sites open their search page with the generated query shown alongside.
- Remote OK public JSON feed adapter; source attribution and original listing links are shown. No logo is used. Jobs from the feed retain the original listing URL and retrieval timestamp.
- Ranked, sortable job-results table with keyword, search-location, posted-date, work-mode, salary-stated, employment-type, and application-status filters. Each row exposes score rationale, source evidence, eligibility evidence, and tracking/material controls.
- Automated tests for deduplication, evidence preservation, unknown eligibility, authentication/session validation, and approval expiry/replay.

### Database implementation deviation

The approved technology choice was SQLite plus Prisma. The repository did not contain Prisma, the package was not present in the dependency cache, and package registry access did not complete in this environment. To deliver a usable local application without claiming an unverified install, this increment uses Node's built-in `node:sqlite` through repository interfaces. Migrate that adapter to Prisma when registry access is available; the data-access boundary is designed for this. No deployment should proceed until this trade-off is reviewed.

## Architecture

- **Web/UI/API:** Next.js App Router with TypeScript.
- **Persistence:** SQLite with repository interfaces. SQLite is simple and low-cost for local or single-instance use but has limited concurrent writes and requires persistent file storage, backup/restore, and migration planning. Reconsider Postgres for multi-instance or high-concurrency hosting.
- **Discovery:** Server-side source adapters, separately bounded and observable. Greenhouse is the first adapter; manual links are never fetched. The scheduled route is called by a scheduler configured by the operator.
- **AI:** No AI dependency in the baseline. Matching and materials work deterministically without an API key.
- **External actions:** approval records and decision checks only; no external execution in v0.1.

### Greenhouse access verification

Verified against Greenhouse's official [Job Board API documentation](https://docs.greenhouse.io/job-board) and [API overview](https://support.greenhouse.io/hc/en-us/articles/10568627186203-Greenhouse-API-overview) on 2026-10-23. Greenhouse documents JSON GET endpoints for public job-board data and describes the API as a way to access public job posts. This app calls only the public job-list GET endpoint; the separate authenticated application-submission endpoint is not implemented or called. Users supply a board token.

### Search destination and Remote OK access verification

Reviewed the sources' own documentation on 2026-10-29. [Remote OK's FAQ](https://remoteok.com/faq) documents free, unauthenticated JSON/RSS feeds and permits sharing/aggregation when Remote OK is credited and every role links to its original post. The adapter uses the public JSON endpoint and follows that attribution requirement. [LinkedIn's API terms](https://developer.linkedin.com/legal) and [scraping policy](https://www.linkedin.com/help/linkedin/answer/a1341387/prohibition-of-scraping-software?intendedLocale=en&lang=en-us) prohibit unapproved scraping; LinkedIn is a search link only. [Remotive's API terms](https://remotive.com/remote-jobs/api) require source attribution and links and prohibit using its listings to collect signups/emails; because this app has account sign-in, Remotive remains link-only. [We Work Remotely's API terms](https://weworkremotely.com/api-terms-and-guidelines) prohibit building a job search service from its data and prohibit storing its data, so it remains link-only despite its public RSS feed. We do not scrape destinations without an authorized interface.

## Directory structure

```text
src/
  app/                    # Dashboard and API routes
  components/             # Dashboard UI
  domain/                 # Job types and deterministic matching
  adapters/persistence/   # Repository interfaces and SQLite adapter
  services/               # Discovery and application-material generation
  lib/                    # Authentication and HTTP validation
tests/                    # SQLite-backed unit/integration checks
docs/plan.md
```

## Data model

- **User/session:** one initial account; scrypt password hash, salt, expiring hashed session token.
- **CandidateProfile:** JSON profile with summary, target roles, regions, qualifications, and review flags; version increments on save.
- **Job:** normalized posting, original HTTPS URL, source, remote clue, work eligibility, status, notes, deduplication key, timestamps.
- **JobEvidence:** field value, source URL, retrieval timestamp. New values append snapshots; unchanged values are not duplicated.
- **DiscoveryRun:** source, start/end, success/failure, imported count, error.
- **ApprovalRequest:** action, exact payload, payload hash, pending/approved/rejected state, expiry, decision time.
- **AuditLog:** requested/approved/rejected/denied event history.
- **ApplicationMaterial:** editable generated draft tied to a job and type.
- **Settings:** local Greenhouse board token. It is a public-board identifier, not an API credential.

## Matching and evidence

Match score is a weighted, inspectable heuristic: role wording (35%), experience/skill-term overlap (30%), location clues (20%), and explicit eligibility evidence (15%). Each result includes component values, matched terms, missing criteria, and an explanation. Treat the score as a review aid, not a probability. Eligibility changes to supported/contradicted only when an evidence note is present. Greenhouse's parser recognizes only explicit Mexico work-location statements; all other cases stay unknown. Candidate profile terms are reported claims, not verified facts.

Every imported/manual job retains its source URL and retrieval time per changed field. Job descriptions and imported HTML are untrusted input; text is stripped/escaped before display. Manual URLs are not fetched, which avoids arbitrary-URL server-side request forgery.

## Approval policy

An authenticated user creates a request bound to a job, action, exact payload and SHA-256 hash, with a 24-hour expiry. Server-side decision checks require a pending, unexpired record whose payload hash still matches. Decisions are audited; repeated or expired decisions are rejected. No route invokes an external system. Each future application submission, email, recruiter message, or other external action will need its own explicit approval and separate execution controls.

## Security and cost controls

- First-run single account; password minimum 12 characters; scrypt hashes; session cookies are HTTP-only, SameSite strict, and secure in production.
- Production requires `SESSION_SECRET`; the scheduled endpoint requires `SCHEDULE_SECRET` and a bearer header.
- Validate content type, request size, fields, HTTPS job URLs, Greenhouse token, source response size, and fetch timeout. Fixed Greenhouse hostname prevents arbitrary outbound fetches.
- No user-controlled HTML rendering, source instructions, AI tool use, or external action execution.
- No secrets or local DB committed. No paid integrations, AI provider, deployment, or outreach.
- Add rate limiting, session cleanup, backup/restore automation, and multi-user ownership before public deployment.

## Acceptance criteria and status

### Foundation

- [x] Local app shell, setup instructions, approved scope.
- [x] Baseline needs no AI key.

### Profile and discovery

- [x] Editable, candidate-reported profile with review flags.
- [x] Manual job URL entry plus one officially documented public source adapter.
- [x] Idempotent URL upsert and field-level evidence history.
- [x] Discovery success/failure records and protected scheduled endpoint.
- [x] Editable multi-location search preferences, profile-derived title terms, and editable profile-mentioned company suggestions.
- [x] Each selected location yields a distinct generated search query.
- [x] Ten search destinations (five general and five remote-focused) listed in a provider registry; use documented feeds/APIs only where permitted and prefilled searches otherwise.
- [x] Import matching Remote OK listings from its public feed with source credit, original job links, retrieval timestamps, and per-location query evidence.
- [x] Ranked results presented in a sortable table with supported date, salary-status, work-mode, and employment-type filters.
- [x] Alerts and notifications remain out of scope.

### Evidence, matching, tracking, and materials

- [x] Source URLs and retrieval times retained per changed field.
- [x] Unknown eligibility is visible and never counted as supported.
- [x] Match component scores, matched/missing criteria, and explanation shown.
- [x] Track job status and notes.
- [x] Generate and edit profile-grounded cover letter and resume-highlight drafts.

### Approval and verification

- [x] Authenticated routes enforce session checks.
- [x] Approval requests bind action/payload and expire; replay/expired decisions are rejected and audited.
- [x] No external-action execution is present.
- [x] Automated tests cover deduplication, evidence, eligibility uncertainty, authentication/session validation, and approval enforcement.
- [ ] Prisma runtime adapter: pending dependency access (see deviation above).
- [ ] Production deployment and scheduled-task setup: not authorized/in scope.

## Local checks

```sh
npm test
npm run typecheck
npm run build
```

## Next before deployment

Move persistence to the approved Prisma adapter when package access permits; add rate limiting and explicit multi-user ownership if needed; document/verify SQLite backup and restore or choose Postgres; set persistent secrets; configure a scheduler; review security and privacy; then obtain separate deployment authorization.
