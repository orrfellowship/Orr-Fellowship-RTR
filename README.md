# Orr Recruiting

Orr Recruiting is a private recruiting operations workspace for the Orr Fellowship team. It centralizes candidate pipeline visibility, school/team dashboards, playbook tasks, recruiting events, budget tracking, resource sharing, user management, JazzHR synchronization, resume access, and notification workflows.

The application is role-aware: fellows and team leads work in school-scoped workspaces, while admins and super admins use an organization-wide console.

## Architecture

- **Next.js 16**: App Router application under `src/app`, with server components, server actions, API routes, and shared UI components.
- **Vercel**: Expected hosting platform for preview and production deployments.
- **Supabase Auth and PostgreSQL**: Authentication, profile/role data, recruiting data, storage, and server-side data access. Server-only service role usage bypasses RLS and must be handled carefully.
- **JazzHR integration**: API routes and helper clients import applicants, synchronize JazzHR IDs, resolve resume documents, and support candidate review workflows.
- **Resend notifications**: Transactional system email is sent through the existing Resend integration, including user invites and recruiting digests.
- **Gmail OAuth (Phase 1)**: RTR users can securely connect an Orr Fellowship Google account for future campaign delivery. Campaign sending is not implemented.

## Prerequisites

- Node 22 or newer
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

   Run the full local quality gate before opening a pull request:

   ```sh
   npm run check
   ```

6. Start the local development server:

   ```sh
   npm run dev
   ```

## Production Credential Warning

Local credentials may point to production Supabase, JazzHR, Resend, or Vercel resources. Treat every value in `.env.local` as potentially production-connected unless you have explicitly verified otherwise.

Before running scripts, API routes, sync flows, or SQL, confirm which Supabase project, JazzHR account, and Resend account the credentials target.

## Gmail OAuth setup (Phase 1)

1. In the Google Cloud project used by RTR, enable the **Gmail API**.
2. Configure the OAuth consent screen for the Orr Fellowship Google Workspace organization.
3. Create an OAuth 2.0 Client ID with application type **Web application**.
4. Add these authorized redirect URIs exactly (scheme, host, port, path, and trailing slash must match):

   - Local: `http://localhost:3000/api/google/callback`
   - Production: `https://YOUR_PRODUCTION_HOST/api/google/callback`

5. Request only `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. The `openid` and `email` scopes verify the connected address; `gmail.send` is the only Gmail permission.
6. Configure these server-only environment variables:

   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI` (one exact URI from step 4 for that environment)
   - `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` (a base64-encoded 32-byte key; generate with `openssl rand -base64 32`)

7. Apply [`db/phase15.sql`](db/phase15.sql) in the target Supabase project's SQL editor before deploying the code.

The OAuth `hd` hint prefers `orrfellowship.org`, but the callback independently verifies the returned Google email. Refresh tokens are encrypted with AES-256-GCM before storage. The credential table is inaccessible to browser roles; only safe connection status fields are returned by the application.
