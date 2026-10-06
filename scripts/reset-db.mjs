import dotenv from "dotenv";
import { Pool } from "pg";

dotenv.config({ path: ".env.local" });
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL in .env.local before resetting PostgreSQL data.");

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined });
try {
  await pool.query("TRUNCATE TABLE activity_events, notifications, tickets, users RESTART IDENTITY CASCADE");
  console.info("Cleared PostgreSQL support data. Restart the app to recreate configured seed accounts.");
} finally {
  await pool.end();
}
