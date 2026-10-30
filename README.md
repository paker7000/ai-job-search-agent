# AI Job-Search Agent

A local-first browser app for evidence-based job discovery, fit review, application tracking, and editable application-material drafts. See [docs/plan.md](docs/plan.md) for scope, trade-offs, and acceptance criteria.

## Requirements

- Node.js 24 recommended (`node:sqlite` is used for persistence).
- npm.

## Start and stop locally (Windows PowerShell)

Open PowerShell in the project folder. On the first run, install dependencies; then set local secrets and start the development server:

```powershell
npm install
$env:SESSION_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
$env:SCHEDULE_SECRET = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
npm run dev -- --hostname 127.0.0.1
```

Keep that terminal open while using the app at [http://localhost:3000](http://localhost:3000). To stop it, focus the same terminal and press **Ctrl+C**. Run the commands again to start it later. Generating a new `SESSION_SECRET` on restart invalidates existing browser sessions, so sign in again; it does not delete the local account or database. No AI key is needed. The default database is `data/agent.sqlite`; override it with `DATABASE_PATH`.

On first use, create the single local account with a unique password of at least 12 characters. In production, configure a persistent `SESSION_SECRET` or sessions will be invalidated when it changes.

The app starts with the candidate facts and target preferences provided for this project. Facts are labeled candidate-reported, and review flags identify missing details and unconfirmed claims. Edit the profile in the dashboard before using generated materials.

## Discover jobs

- Paste a job URL manually, or enter a Greenhouse public board token and select **Fetch public roles**. The app uses Greenhouse's documented public Job Board API. It does not crawl arbitrary URLs or submit applications.
- Edit the search plan's title keywords, company suggestions, and locations (prefilled with Mexico, Monterrey area, and Texas). Each location produces its own query.
- Search five general sites and five remote-work sites using direct links. Import matches from the Remote OK public feed; other destinations remain link-outs where automated reuse is restricted or not authorized.
- A source run records its outcome, and each changed field retains its source URL and retrieval timestamp.
- The Greenhouse token is stored locally in SQLite and reused by scheduled discovery.
- Unknown work-location eligibility remains unknown. Review the posting evidence; the app does not infer visa or work authorization.

To invoke the protected daily-discovery endpoint after configuring a board token, run:

```powershell
Invoke-RestMethod -Method Post -Uri 'http://localhost:3000/api/scheduled/discover' -Headers @{ Authorization = "Bearer $env:SCHEDULE_SECRET" }
```

This endpoint is ready for a scheduler you operate. No scheduler or hosting service is created or configured by the app. Do not expose the local app publicly without a security review.

## Approval and application materials

The dashboard can create action-specific approval records and record approve/reject decisions. Approval does not trigger an external action: there is no application, email, or recruiter-message executor in v0.1. Generated cover-letter and resume-highlight drafts use the saved candidate profile only; review, edit, and verify them before use.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The automated suite covers URL deduplication, evidence preservation, unknown eligibility, account/session validation, and approval expiry/replay behavior.

## Database trade-off

SQLite is straightforward and cost-conscious for local development or a single application instance. It has limited concurrent write throughput; the database file needs persistent storage, backups, restore procedures, and migration planning. Multi-instance hosting or heavier write concurrency may warrant Postgres. Reassess before deployment.

The approved architecture named Prisma, but Prisma packages were not available in the local dependency cache and registry access did not complete in this environment. This increment uses Node's built-in SQLite driver behind repository interfaces so the application can run without adding an unverified dependency. Move the persistence adapter to Prisma when package access is available; deployment remains out of scope.

## Privacy

Do not commit secrets or the local SQLite database. Candidate/profile data and job evidence are stored locally by default. No AI provider is configured, no paid service is used, and no external action is executed.
