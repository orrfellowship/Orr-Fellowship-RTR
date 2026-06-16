# Orr Recruiting

Orr Recruiting is a private recruiting operations workspace for the Orr Fellowship team. It centralizes candidate pipeline visibility, school/team dashboards, playbook tasks, recruiting events, budget tracking, resource sharing, user management, JazzHR synchronization, resume access, and notification workflows.

The application is role-aware: fellows and team leads work in school-scoped workspaces, while admins and super admins use an organization-wide console.

## Architecture

- **Next.js 14**: App Router application under `src/app`, with server components, server actions, API routes, and shared UI components.
- **Vercel**: Expected hosting platform for preview and production deployments.
- **Supabase Auth and PostgreSQL**: Authentication, profile/role data, recruiting data, storage, and server-side data access. Server-only service role usage bypasses RLS and must be handled carefully.
- **JazzHR integration**: API routes and helper clients import applicants, synchronize JazzHR IDs, resolve resume documents, and support candidate review workflows.
- **SMTP notifications**: Transactional email is sent through SMTP credentials, including user invites and recruiting digests.

## Prerequisites

- Node 20
- npm
- Git

## Local Setup

1. Clone the repository:

   ```sh
   git clone <repository-url>
   cd Orr-Fellowship-RTR
   ```

2. Install dependencies:

   ```sh
   npm ci
   ```

3. Create a local environment file:

   ```sh
   cp .env.local.example .env.local
   ```

4. Fill in `.env.local` with the required values.

5. Run type checking:

   ```sh
   npm run typecheck
   ```

6. Start the local development server:

   ```sh
   npm run dev
   ```

## Environment Variables

| Variable | Required | Scope | Description |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Browser and server | Supabase project URL. Public, but determines which project the app uses. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Browser and server | Supabase anon key used by browser and SSR clients. Public, but tied to the configured project. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server only | Supabase service role key. Bypasses RLS and must never be exposed to the browser. |
| `JAZZHR_API_KEY` | Yes | Server only | JazzHR API key used for applicant sync and legacy resume access. |
| `NEXT_PUBLIC_SITE_URL` | Yes | Browser and server | Canonical site URL used for links in emails and scheduled jobs. |
| `SMTP_HOST` | Yes for email | Server only | SMTP host for transactional email. |
| `SMTP_PORT` | Yes for email | Server only | SMTP port, usually `587`. |
| `SMTP_USER` | Yes for email | Server only | SMTP username. |
| `SMTP_PASS` | Yes for email | Server only | SMTP password. |
| `SMTP_FROM` | Yes for email | Server only | From address used for outgoing email. |
| `CRON_SECRET` | Yes for cron | Server only | Bearer token checked by `/api/cron`. |
| `JAZZHR_SANDCASTLE_TICKET` | Yes for JazzHR resume document flow | Server only | JazzHR session ticket used by resume document lookup and JazzHR ID sync code. This is used by code but is currently missing from `.env.local.example`. |

## Production Credential Warning

Local credentials may point to production Supabase, JazzHR, SMTP, or Vercel resources. Treat every value in `.env.local` as potentially production-connected unless you have explicitly verified otherwise.

Before running scripts, API routes, sync flows, or SQL, confirm which Supabase project, JazzHR account, and SMTP account the credentials target.

## Branch and Deployment Workflow

- Work on feature branches.
- Push feature branches to open pull requests and get Vercel preview deployments.
- Use preview deployments for review and validation before merge.
- `main` deploys to production.

## Safe Development Warnings

- Do not commit `.env.local`.
- Do not run `clear-data`.
- Do not trigger JazzHR sync without approval.
- Do not run database SQL against production without approval.
- Do not expose `SUPABASE_SERVICE_ROLE_KEY`, `JAZZHR_API_KEY`, `JAZZHR_SANDCASTLE_TICKET`, `SMTP_PASS`, or `CRON_SECRET`.
- Do not assume local development is isolated from production data.

## Main Application Routes and Roles

| Route | Roles | Purpose |
| --- | --- | --- |
| `/` | All authenticated users | Redirects users by role: admins to `/console`, fellows and team leads to `/workspace`. |
| `/login` | Unauthenticated users | Email/password sign-in for invited users. |
| `/auth/callback` | Auth flow | Supabase auth callback. |
| `/auth/invite-callback` | Auth flow | Invite callback. |
| `/auth/set-password` | Auth flow | Password setup for invited users. |
| `/auth/forgot-password` | Auth flow | Password reset request. |
| `/auth/reset-callback` | Auth flow | Password reset callback. |
| `/workspace` | `fellow`, `team_lead` | Redirects to `/workspace/snapshot`. |
| `/workspace/snapshot` | `fellow`, `team_lead` | Weekly snapshot for school-scoped recruiting work. |
| `/workspace/my-school` | `fellow`, `team_lead` | School dashboard. |
| `/workspace/standings` | `fellow`, `team_lead` | School leaderboard. |
| `/workspace/applicants` | `fellow`, `team_lead` | School-scoped candidate pipeline. |
| `/workspace/playbook` | `fellow`, `team_lead` | School playbook and tasks. Team leads have broader edit capabilities. |
| `/workspace/resources` | `fellow`, `team_lead` | Shared resources. |
| `/workspace/budget` | `team_lead` | School budget view and expense workflow. |
| `/console` | `admin`, `super_admin` | Redirects to `/console/overview`. |
| `/console/overview` | `admin`, `super_admin` | Organization-wide dashboard and KPIs. |
| `/console/applicants` | `admin`, `super_admin` | Organization-wide candidate pipeline. |
| `/console/standings` | `admin`, `super_admin` | School leaderboard. |
| `/console/schools` | `admin`, `super_admin` | School/program management. |
| `/console/calendar` | `admin`, `super_admin` | Organization-wide and school recruiting events. |
| `/console/budget` | `admin`, `super_admin` | Budget allocations and expense management. |
| `/console/users` | `admin`, `super_admin` | User invitations, roles, schools, and access management. |
| `/console/review` | `admin` | JazzHR match review workflow for non-super admins. |
| `/console/sync` | `super_admin` | JazzHR sync workflow. |
| `/console/playbook` | `admin`, `super_admin` | Organization-level playbook management. |
| `/console/resources` | `admin`, `super_admin` | Shared resources management. |
| `/how-to` | Authenticated users | In-app usage guide tailored by role. |

### API Routes

| Route | Access | Purpose |
| --- | --- | --- |
| `/api/check-invite` | Auth flow | Checks invite status during login/setup flows. |
| `/api/cron` | `CRON_SECRET` bearer token | Scheduled recruiting digest and notification work. |
| `/api/resume` | Authenticated users | Fetches or signs candidate resume documents. |
| `/api/sync` | `super_admin` | JazzHR sync endpoints. |
| `/api/sync-jazz-ids` | `super_admin` | Synchronizes JazzHR prospect ID mappings for resume lookup. |
| `/api/clear-data` | `super_admin` plus exact confirmation phrase | Deletes candidate data and resets sync metadata. Do not run without explicit approval. |

## Known Documentation Gaps

- Database migrations are incomplete. The `db/phase*.sql` files are present, but there is not yet a complete migration history suitable for rebuilding every environment from scratch.
- `JAZZHR_SANDCASTLE_TICKET` is used by the code but is missing from `.env.local.example`.
