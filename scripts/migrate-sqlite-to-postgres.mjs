import dotenv from "dotenv";
import Database from "better-sqlite3";
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local before migrating.");
if (!fs.existsSync("support.db")) throw new Error("No support.db found to import.");

const source = new Database("support.db", { readonly: true });
const target = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined });
const client = await target.connect();
const tables = ["users", "tickets", "notifications", "activity_events"];
let imported = 0;

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('staff','admin')),department TEXT,job_title TEXT,location TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,ticket_code TEXT UNIQUE,user_id BIGINT NOT NULL REFERENCES users(id),full_name TEXT NOT NULL,
      work_email TEXT NOT NULL,department TEXT NOT NULL,job_title TEXT NOT NULL,location TEXT NOT NULL,request_type TEXT NOT NULL,
      request_subtype TEXT NOT NULL,category TEXT NOT NULL,priority TEXT NOT NULL,subject TEXT NOT NULL,description TEXT NOT NULL,
      attachment_path TEXT,attachment_name TEXT,attachment_data BYTEA,resolution TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'Open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),resolved_at TIMESTAMPTZ,assigned_to BIGINT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY,user_id BIGINT NOT NULL REFERENCES users(id),ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
      title TEXT NOT NULL,message TEXT NOT NULL,read_at TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS activity_events (
      id BIGSERIAL PRIMARY KEY,actor_id BIGINT,actor_name TEXT NOT NULL,actor_email TEXT NOT NULL,actor_role TEXT NOT NULL,
      action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON tickets(user_id);
    CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
    CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id,read_at);
    CREATE INDEX IF NOT EXISTS activity_events_created_idx ON activity_events(id DESC);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachment_data BYTEA;
  `);

  for (const table of tables) {
    const rows = source.prepare(`SELECT * FROM ${table}`).all();
    for (const row of rows) {
      if (table === "users") {
        await client.query(`INSERT INTO users (id,name,email,password_hash,role,department,job_title,location,active,is_super_admin,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`,
        [row.id, row.name, String(row.email).toLowerCase(), row.password_hash, row.role, row.department, row.job_title, row.location, row.active === undefined ? true : Boolean(row.active), Boolean(row.is_super_admin), row.created_at]);
      } else if (table === "tickets") {
        let attachmentData = null;
        if (row.attachment_path) {
          try { attachmentData = fs.readFileSync(path.join(process.cwd(), "uploads", path.basename(row.attachment_path))); }
          catch { console.warn(`Attachment file missing for legacy ticket ${row.ticket_code || row.id}; metadata will be imported without file bytes.`); }
        }
        await client.query(`INSERT INTO tickets (id,ticket_code,user_id,full_name,work_email,department,job_title,location,request_type,request_subtype,category,priority,subject,description,attachment_path,attachment_name,attachment_data,resolution,status,created_at,updated_at,resolved_at,assigned_to)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) ON CONFLICT DO NOTHING`,
        [row.id,row.ticket_code,row.user_id,row.full_name,row.work_email,row.department,row.job_title,row.location,row.request_type,row.request_subtype,row.category,row.priority,row.subject,row.description,row.attachment_path,row.attachment_name,attachmentData,row.resolution,row.status,row.created_at,row.updated_at,row.resolved_at,row.assigned_to]);
      } else if (table === "notifications") {
        await client.query(`INSERT INTO notifications (id,user_id,ticket_id,title,message,read_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [row.id,row.user_id,row.ticket_id,row.title,row.message,row.read_at,row.created_at]);
      } else {
        await client.query(`INSERT INTO activity_events (id,actor_id,actor_name,actor_email,actor_role,action,entity_type,entity_id,details,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,
        [row.id,row.actor_id,row.actor_name,row.actor_email,row.actor_role,row.action,row.entity_type,row.entity_id,row.details,row.created_at]);
      }
      imported += 1;
    }
  }
  for (const table of tables) {
    await client.query(`SELECT setval(pg_get_serial_sequence('${table}','id'), GREATEST(COALESCE((SELECT MAX(id) FROM ${table}), 1), 1), EXISTS(SELECT 1 FROM ${table}))`);
  }
  await client.query("COMMIT");
  console.info(`Imported ${imported} SQLite rows into PostgreSQL. The original support.db was not modified.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  source.close();
  await target.end();
}
