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
