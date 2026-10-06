# LUMEO Internal Support Workspace

## Architecture
- Next.js App Router with TypeScript, Tailwind CSS, and custom responsive CSS. The first route is login-first; do not add a public landing page.
- PostgreSQL uses `pg` and is initialized/migrated/seeds in `lib/db.ts`; configure it via `DATABASE_URL`.
- `lib/auth.ts` resolves the active account from the database on every request. Roles are staff, admin, and superadmin.
- Staff ticket visibility is owner-scoped. Admin and super-admin accounts can see and resolve all tickets.
- Only super-admins may create accounts, change staff/admin roles, deactivate/reactivate accounts, or see audit events. Deactivation is soft so historical ticket and audit references remain intact.
- Store ticket attachments as PostgreSQL `BYTEA` and serve them only through the authenticated ticket attachment endpoint.
- Add persistent events to `activity_events` for authentication, account, and ticket operations.
- Keep the orange / charcoal dashboard theme aligned with `public/lumeo-symbol.svg`.

## Development
- `npm run dev` starts the local app; `npm run lint` and `npm run build` validate it.
- `.env.local`, database credentials, and database dumps must not be committed. The one-time legacy SQLite importer is only a dev tool.
- Change all seeded passwords and `SESSION_SECRET` before deployment.
