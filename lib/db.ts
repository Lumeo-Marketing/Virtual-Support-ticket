import { Pool, type QueryResultRow, type PoolClient } from "pg";
import bcrypt from "bcryptjs";

export type Role = "staff" | "admin" | "superadmin";
export type TicketStatus = "Open" | "InProgress" | "Pending" | "Awaiting User" | "Escalated" | "Resolved" | "Closed";

export interface UserRecord {
  id: number;
  name: string;
  email: string;
  role: Role;
  department: string | null;
  jobTitle: string | null;
  location: string | null;
  active: boolean;
  isSuperAdmin: boolean;
}

export interface TicketRecord {
  id: number;
  ticketCode: string;
  userId: number;
  fullName: string;
  workEmail: string;
  department: string;
  jobTitle: string;
  location: string;
  requestType: string;
  requestSubtype: string;
  category: string;
  priority: string;
  subject: string;
  description: string;
  attachmentPath: string | null;
  attachmentName: string | null;
  resolution: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  assignedTo: number | null;
  assigneeName?: string | null;
}

const globalForDb = globalThis as unknown as { lumeoPool?: Pool; lumeoInit?: Promise<void> };

function pool() {
  if (!globalForDb.lumeoPool) {
    globalForDb.lumeoPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX || 10),
      ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 30000,
    });
    globalForDb.lumeoPool.on("error", (error) => console.error("Unexpected PostgreSQL pool error", error));
  }
  return globalForDb.lumeoPool;
}

async function initializeDatabase() {
  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('staff','admin')),
        department TEXT,
        job_title TEXT,
        location TEXT,
        active BOOLEAN NOT NULL DEFAULT TRUE,
        is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (LOWER(email));
      CREATE TABLE IF NOT EXISTS tickets (
        id BIGSERIAL PRIMARY KEY,
        ticket_code TEXT UNIQUE,
        user_id BIGINT NOT NULL REFERENCES users(id),
        full_name TEXT NOT NULL,
        work_email TEXT NOT NULL,
        department TEXT NOT NULL,
        job_title TEXT NOT NULL,
        location TEXT NOT NULL,
        request_type TEXT NOT NULL,
        request_subtype TEXT NOT NULL,
        category TEXT NOT NULL,
        priority TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        attachment_path TEXT,
        attachment_name TEXT,
        attachment_data BYTEA,
        resolution TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'Open',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMPTZ,
        assigned_to BIGINT REFERENCES users(id)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES users(id),
        ticket_id BIGINT REFERENCES tickets(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS messages (
        id BIGSERIAL PRIMARY KEY,
        sender_id BIGINT NOT NULL REFERENCES users(id),
        recipient_id BIGINT NOT NULL REFERENCES users(id),
        content TEXT NOT NULL,
        read_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS activity_events (
        id BIGSERIAL PRIMARY KEY,
        actor_id BIGINT,
        actor_name TEXT NOT NULL,
        actor_email TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT,
        details TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON tickets(user_id);
      CREATE INDEX IF NOT EXISTS tickets_status_idx ON tickets(status);
      CREATE INDEX IF NOT EXISTS notifications_user_id_idx ON notifications(user_id,read_at);
      CREATE INDEX IF NOT EXISTS messages_participants_idx ON messages(sender_id,recipient_id,created_at DESC);
      CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages(recipient_id,read_at);
      CREATE INDEX IF NOT EXISTS activity_events_created_idx ON activity_events(id DESC);
    `);
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE");
    await client.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE");
    await client.query("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS attachment_data BYTEA");
    await client.query(`CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES users(id),
      recipient_id BIGINT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query("CREATE INDEX IF NOT EXISTS messages_participants_idx ON messages(sender_id,recipient_id,created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS messages_recipient_idx ON messages(recipient_id,read_at)");
    await seedUser(client, { name: "Moses Effiom", email: process.env.ADMIN_EMAIL || "admin@lumeo.com", password: process.env.ADMIN_PASSWORD || "Admin123!", role: "admin", department: "IT", jobTitle: "IT Administrator" });
    await seedUser(client, { name: "Alex Morgan", email: process.env.STAFF_EMAIL || "staff@lumeo.com", password: process.env.STAFF_PASSWORD || "Staff123!", role: "staff", department: "Operations", jobTitle: "Operations Associate" });
    const owner = await seedUser(client, { name: "LUMEO Owner", email: process.env.SUPER_ADMIN_EMAIL || "owner@lumeo.com", password: process.env.SUPER_ADMIN_PASSWORD || "Owner123!", role: "admin", department: "IT", jobTitle: "Super Administrator" });
    await client.query("UPDATE users SET is_super_admin=FALSE WHERE id<>$1 AND is_super_admin=TRUE", [owner.id]);
    await client.query("UPDATE users SET is_super_admin=TRUE,password_hash=$2,active=TRUE WHERE id=$1", [owner.id, bcrypt.hashSync(process.env.SUPER_ADMIN_PASSWORD || "Owner123!", 12)]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function seedUser(client: PoolClient, input: { name: string; email: string; password: string; role: "staff" | "admin"; department: string; jobTitle: string }) {
  const email = input.email.trim().toLowerCase();
  const result = await client.query(`INSERT INTO users (name,email,password_hash,role,department,job_title,location)
    VALUES ($1,$2,$3,$4,$5,$6,'Head Office') ON CONFLICT ((LOWER(email))) DO NOTHING RETURNING id`,
  [input.name, email, bcrypt.hashSync(input.password, 12), input.role, input.department, input.jobTitle]);
  if (result.rows[0]) return { id: Number(result.rows[0].id) };
  const existing = await client.query("SELECT id FROM users WHERE LOWER(email)=LOWER($1)", [email]);
  return { id: Number(existing.rows[0].id) };
}

export async function getDb(): Promise<Pool> {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required. Configure your PostgreSQL connection in .env.local.");
  if (!globalForDb.lumeoInit) globalForDb.lumeoInit = initializeDatabase();
  await globalForDb.lumeoInit;
  return pool();
}

export function asUser(row: Record<string, unknown>): UserRecord {
  const isSuperAdmin = Boolean(row.is_super_admin ?? row.isSuperAdmin);
  return { id: Number(row.id), name: String(row.name), email: String(row.email), role: isSuperAdmin ? "superadmin" : row.role as Role, isSuperAdmin, active: Boolean(row.active ?? true), department: row.department ? String(row.department) : null, jobTitle: (row.job_title ?? row.jobTitle) ? String(row.job_title ?? row.jobTitle) : null, location: row.location ? String(row.location) : null };
}

export async function logActivity(actor: UserRecord, action: string, entityType: string, entityId: string | number | null, details = "") {
  const db = await getDb();
  await db.query(`INSERT INTO activity_events (actor_id,actor_name,actor_email,actor_role,action,entity_type,entity_id,details,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`, [actor.id, actor.name, actor.email, actor.role, action, entityType, entityId === null ? null : String(entityId), details.slice(0, 500)]);
}

export function asTicket(row: QueryResultRow | Record<string, unknown>): TicketRecord {
  return {
    id: Number(row.id), ticketCode: String(row.ticket_code ?? row.ticketCode ?? ""), userId: Number(row.user_id ?? row.userId), fullName: String(row.full_name ?? row.fullName), workEmail: String(row.work_email ?? row.workEmail),
    department: String(row.department), jobTitle: String(row.job_title ?? row.jobTitle), location: String(row.location), requestType: String(row.request_type ?? row.requestType), requestSubtype: String(row.request_subtype ?? row.requestSubtype),
    category: String(row.category), priority: String(row.priority), subject: String(row.subject), description: String(row.description), attachmentPath: (row.attachment_path ?? row.attachmentPath) ? String(row.attachment_path ?? row.attachmentPath) : null,
    attachmentName: (row.attachment_name ?? row.attachmentName) ? String(row.attachment_name ?? row.attachmentName) : null, resolution: String(row.resolution || ""), status: row.status as TicketStatus,
    createdAt: String(row.created_at ?? row.createdAt), updatedAt: String(row.updated_at ?? row.updatedAt), resolvedAt: (row.resolved_at ?? row.resolvedAt) ? String(row.resolved_at ?? row.resolvedAt) : null,
    assignedTo: (row.assigned_to ?? row.assignedTo) == null ? null : Number(row.assigned_to ?? row.assignedTo), assigneeName: (row.assignee_name ?? row.assigneeName) ? String(row.assignee_name ?? row.assigneeName) : null,
  };
}
