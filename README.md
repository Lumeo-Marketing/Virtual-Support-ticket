# LUMEO Internal Support Workspace

Login-first internal IT support portal for staff, IT administrators, and the super administrator. PostgreSQL is the primary and only runtime store for accounts, tickets, notifications, audit events, and ticket attachment bytes. Attachments are only downloaded via the authenticated ticket endpoint.

## PostgreSQL setup

Create a database and a login for the application in your local PostgreSQL installation. For example, from `psql` connected as a PostgreSQL administrator:

```sql
CREATE ROLE lumeo_user WITH LOGIN PASSWORD 'replace-with-a-strong-random-password';
CREATE DATABASE lumeo_support OWNER lumeo_user;
```

Copy `.env.example` to `.env.local`, then set `DATABASE_URL` to match that role/password/database. URL-encode special characters in the password. `PGSSL=true` is only for a PostgreSQL endpoint requiring TLS; local PostgreSQL normally uses `PGSSL=false`.

For a local installation using the current macOS account, if that account has PostgreSQL login/database creation rights, a typical URL is `postgresql://YOUR_MAC_USERNAME@localhost:5432/lumeo_support`.

Install dependencies and start the application:

1. `npm install`
2. `npm run dev`
3. Open `http://localhost:3000` and sign in.

The schema and indexes are created automatically on the first database request and upgraded safely on subsequent starts. Keep PostgreSQL running while the app is running. You can inspect and back up all structured records using your normal PostgreSQL tools.

## GoHighLevel custom menu links

Use the same deployed HTTPS portal URL for the GHL custom menu link and direct access. For an embedded page, production sessions use `Secure; HttpOnly; SameSite=None; Partitioned` cookies. Local HTTP development keeps `SameSite=Lax` cookies and is intended for direct access.

Set `APP_URL` in the deployment environment to that exact public HTTPS portal URL (for example, `https://support.example.com`), then rebuild and restart the app. The API request guard accepts this configured origin even when the hosting proxy passes an internal server URL to Next.js. Use the portal URL here, rather than the GHL dashboard URL. Requests from unrelated origins remain blocked.

Ticket email buttons link directly to `/tickets/<id>`. A signed-in administrator opens that exact ticket; signed-out users see sign-in first and then the requested ticket. Existing `/?ticket=<id>` links also work. On Railway, set `APP_URL=https://virtual-support-ticket-production.up.railway.app` (or your custom portal domain) and redeploy the application after code changes. When `APP_URL` is absent or still points to localhost, email links use Railway's `RAILWAY_PUBLIC_DOMAIN`. The email link must use the same domain where the administrator signed in. Previously delivered emails keep the links they originally contained.

After deploying this session update, sign in again. Embedded and direct sessions are independent because the browser partitions cookies by the top-level site; signing in or out in one context does not sign in or out in the other. Both views still use the deployment's same PostgreSQL database and account permissions. A custom menu link does not provide GHL single sign-on.

Login now checks that the browser sends the session back before opening the dashboard. If the browser or embedding settings still block sessions, the sign-in screen offers a link to open the workspace in a new tab. You can also set the GHL custom menu link to **New Browser Tab**. If the two views still show different data, check that the menu points to the exact same deployment and that you are using the same account.

## Existing local SQLite data

The app no longer reads SQLite at runtime. To copy existing `support.db` users, tickets, notifications, and audit events into the configured PostgreSQL database, set `DATABASE_URL` in `.env.local` and run:

`npm run db:migrate:sqlite`

Run the import before starting the app against a new/empty PostgreSQL database. It creates the schema, imports records with their existing IDs, copies available legacy uploaded files into PostgreSQL, keeps the source `support.db` unchanged, and advances PostgreSQL ID sequences. It is safe to repeat against those imported IDs, but do not mix the import with already-created accounts/tickets. If an old file is missing from `uploads/`, its ticket metadata is imported but the missing binary cannot be recovered.

If there is no `support.db` to preserve, simply start the app; PostgreSQL seed users are added automatically if their email addresses do not already exist.

## Initial accounts

Set these environment variables before the database is first populated:

- `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD`
- `STAFF_EMAIL` / `STAFF_PASSWORD`

For an empty database only, `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` choose the super-admin login; local values belong in the gitignored `.env.local`, not in this document. The fallback accounts are `admin@lumeo.com` / `Admin123!` and `staff@lumeo.com` / `Staff123!`. Existing account passwords are never overwritten when the app restarts. The configured super-admin becomes the sole super-admin on initialization; other accounts and ticket history are preserved. Set a random `SESSION_SECRET` of at least 32 characters and change all demo passwords before use beyond local development.

## Roles and stored data

- Staff can create and track their own tickets.
- IT admins can read all requests, update status, and add resolutions.
- Super admins can manage staff/admin accounts and review workspace activity.
- The super-admin Reports & analytics page includes ticket/activity filtering, status and volume charts, resolution-duration/SLA metrics, IT-owner workload, paginated records, and CSV exports.
- Dashboard tables are paginated. Ticket search includes status, category, priority, request type, and creation-date filters; the overview greets the signed-in user by name.
- Deactivation disables sign-in while preserving historical tickets and events.
- PostgreSQL stores accounts and password hashes, ticket metadata and descriptions, notification inbox items, and the super-admin activity log.
- Ticket attachment bytes are stored in PostgreSQL `BYTEA` columns with their metadata. Back up PostgreSQL to preserve them.
- Creating an account sends a welcome email with its temporary password and a **Set your password** link. Leave the temporary-password field blank to generate a random password, or supply one of at least 10 characters. Email dispatch runs after the account transaction commits.
- The welcome link opens `/reset-password` with password and confirmation fields. Links expire in 24 hours and work once. Only a SHA-256 hash of each random reset token is stored. Resetting the password replaces the temporary password and invalidates existing sessions; inactive accounts and links issued before an email/password change cannot reset a password. PostgreSQL creates the reset-token table and session-version column automatically after deployment/restart.
- With SMTP configured, a new ticket sends a branded receipt to the requester and a new-ticket alert to `SUPPORT_ADMIN_EMAILS` (default: `moses@twinklehealthcare.com`); `SUPPORT_ADMIN_CC` (default: `godwin@lumeomarketing.com`) receives a copy (CC) of the admin alert. Admin status/resolution updates send a branded email to the requester, with a distinct completed/resolved message when appropriate. In-app notifications are also stored in PostgreSQL.
- Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and the externally accessible `APP_URL` in `.env.local`. Set `SMTP_FROM` to a sender address/name verified by your mail provider (if blank, the app uses `SMTP_USER`). `SUPPORT_ADMIN_EMAILS` sets ticket alert recipients and overrides the default `moses@twinklehealthcare.com`; separate multiple addresses with commas. `SUPPORT_ADMIN_CC` sets CC recipients and defaults to `godwin@lumeomarketing.com`. `SUPPORT_REPLY_TO` optionally sets a monitored reply-to address.
- If SMTP is omitted or unavailable, tickets still save and in-app notifications still work; email failures are logged without undoing ticket submission or resolution.

`npm run db:reset` is destructive: it truncates PostgreSQL support tables and resets their IDs. It is for development only; it requires the database tables to exist, then the next application start reseeds the configured initial accounts.

## Scripts

- `npm run dev` — start local development.
- `npm run build` — compile the production build.
- `npm start` — serve the production build.
- `npm run lint` — lint source files.
- `npm run db:migrate:sqlite` — import an existing legacy SQLite database into PostgreSQL.
- `npm run db:reset` — clear PostgreSQL app data (destructive).
