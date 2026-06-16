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

## Production Credential Warning

Local credentials may point to production Supabase, JazzHR, SMTP, or Vercel resources. Treat every value in `.env.local` as potentially production-connected unless you have explicitly verified otherwise.

Before running scripts, API routes, sync flows, or SQL, confirm which Supabase project, JazzHR account, and SMTP account the credentials target.

