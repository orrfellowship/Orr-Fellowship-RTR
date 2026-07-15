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

### Local mock Gmail campaign test (Phase 3)

Phase 3 connects the existing four-stage Email Campaigns prototype to real Gmail delivery while retaining fictional candidate records. Eligible fictional candidates use only the controlled test addresses `samuel.brumley@orrfellowship.org` and `sam@brumley.cloud`; multiple candidates intentionally share those inboxes. One selected eligible fictional candidate always produces one separate personalized Gmail message.

The endpoint is `POST /api/google/send-demo-campaign`. It resolves candidate IDs against the server-owned mock dataset, recalculates missing-email, unsubscribed, and Do Not Contact exclusions, renders merge variables separately, and sends sequentially. It accepts at most 10 selected mock candidates and never accepts browser-supplied recipient addresses. A short-lived in-memory idempotency record prevents an immediate retry of the same request identifier from sending duplicates.

The route is unavailable whenever `NODE_ENV=production` and defaults to disabled in development. To enable the Review-stage **Send with Gmail** action locally, add this to `.env.local` and restart the development server:

```sh
ENABLE_GMAIL_TEST_SEND=true
```

Local manual test — this sends real email:

1. Keep the Google OAuth project in Testing mode and ensure the intended `@orrfellowship.org` account is an allowed test user.
2. Start the app with `npm run dev` and sign in to RTR.
3. Open `/console/email-campaigns` and connect Gmail if needed.
4. Use **My Candidates**, **Compose**, and **Preview** to inspect the fictional audience and personalized content.
5. On **Review**, confirm the connected sender, eligible count, and automatic exclusion reasons.
6. Check the explicit real-send confirmation.
7. Click **Send with Gmail** once.
8. Confirm the attempted, sent, failed, and excluded summary plus each fictional candidate result. Verify that each eligible candidate produced one message in the controlled inbox, including candidates sharing an address.
9. Return `ENABLE_GMAIL_TEST_SEND=false` when testing is complete.

This phase uses no production candidate data, campaign tables, queues, schedules, retries, or campaign persistence. It does not update candidate contact history or stages and does not change the existing Resend transactional-email integration. Results exist only in the current client state. The Google OAuth project may remain in Testing mode for this local test. Access tokens, refresh tokens, MIME content, authorization headers, and raw Google responses never cross the server boundary.
