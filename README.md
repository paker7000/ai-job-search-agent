# AI Job-Search Agent

A local-first browser app for evidence-based job discovery, fit review, application tracking, and editable application-material drafts. See [docs/plan.md](docs/plan.md) for scope, trade-offs, and acceptance criteria.

## Requirements

- Node.js 24 recommended (`node:sqlite` is used for persistence).
- npm.

## Start and stop locally (Windows PowerShell)

Open PowerShell in the project folder. On the first run, install dependencies and create an ignored local secrets file:

```powershell
npm install
if (-not (Test-Path .env.local)) {
  Copy-Item .env.example .env.local
  $sessionSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  $scheduleSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
  @("SESSION_SECRET=$sessionSecret", "SCHEDULE_SECRET=$scheduleSecret") | Set-Content .env.local
}
npm run dev -- --hostname 127.0.0.1
```

Keep that terminal open while using the app at [http://localhost:3000](http://localhost:3000). To stop it, focus the same terminal and press **Ctrl+C**. Run `npm run dev -- --hostname 127.0.0.1` again to start it later. Keep `.env.local` unchanged between restarts so browser sessions remain valid. No AI key is needed. The default database is `data/agent.sqlite`; override it with `DATABASE_PATH`.

On first use, create the single local account with a unique password of at least 12 characters. In production, configure a persistent `SESSION_SECRET` or sessions will be invalidated when it changes.

The app starts with the candidate facts and target preferences provided for this project. Facts are labeled candidate-reported, and review flags identify missing details and unconfirmed claims. Edit the profile in the dashboard before using generated materials.

## Discover jobs

- Paste a job URL manually, or enter a Greenhouse public board token and select **Fetch public roles**. The app uses Greenhouse's documented public Job Board API. It does not crawl arbitrary URLs or submit applications.
- Edit the search plan's title keywords, company suggestions, and locations (prefilled with Mexico, Monterrey area, and Texas). Each location produces its own query.
- Search five general sites and five remote-work sites using direct links. Import matches from the Remote OK public feed; other destinations remain link-outs where automated reuse is restricted or not authorized.
- Review ranked results in a table. Filters cover keywords, searched location, posted date, stated salary, work mode, employment type, and application status. Match explanations and evidence trails remain available per job.
- A source run records its outcome, and each changed field retains its source URL and retrieval timestamp.
- The Greenhouse token is stored locally in SQLite and reused by scheduled discovery.
- Unknown work-location eligibility remains unknown. Review the posting evidence; the app does not infer visa or work authorization.

The protected daily-discovery endpoint searches the configured Greenhouse board, if any, and Remote OK. It runs the sources in sequence, records each source's success or failure, and still attempts the second source if the first one fails. To run it manually:

```powershell
& .\scripts\run-daily-discovery.ps1
```

To schedule it on Windows without a hosted service, use Task Scheduler: create a daily task that runs `powershell.exe` with arguments `-NoProfile -ExecutionPolicy Bypass -File "C:\dev\ai-job-search-agent\scripts\run-daily-discovery.ps1"`. Run it as your logged-in Windows user. The local app must already be running at `127.0.0.1:3000` when the task fires; the task sends only the protected local request. No scheduled task is created automatically. Do not expose the local app publicly without a security review.

## Approval and application materials

Use **Quick review** to inspect one ranked role at a time. Swipe or choose **Shortlist** / **Skip**; these actions only update local tracking. **Review docs** opens editable cover-letter and resume-highlight drafts generated from the saved candidate profile. Save and download the drafts, then open the employer's application page in a separate tab and submit there yourself. Only after submission should you choose **I submitted this application** to record the local status. The app never uploads a document or submits an application. Existing action-specific approval records are audit-only and do not trigger an external action. Review every generated statement before use.

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
