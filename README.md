# AI Job-Search Agent

An early-stage browser-based job discovery and tracking app. See [docs/plan.md](docs/plan.md) for approved scope, architecture, milestones, and acceptance criteria.

## Local setup

Prerequisite: Node.js and npm. Install the dependencies and start the development server:

```sh
npm install
npm run dev
```

The foundation is being built incrementally. This initial scaffold does not yet include the job workflow or require credentials. The baseline is designed to work without an AI API key.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

## Privacy and external actions

Do not add secrets to source control. v0.1 will record approvals and enforce approval policy server-side; it will not execute applications, emails, recruiter messages, or other external actions.
