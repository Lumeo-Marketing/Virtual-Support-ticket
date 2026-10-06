import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  const db = await getDb();
  const users = await db.query(`SELECT u.id,u.name,u.email,u.role,u.department,u.job_title AS "jobTitle",u.location,u.active,u.is_super_admin AS "isSuperAdmin",u.created_at AS "createdAt",
      (SELECT COUNT(*) FROM tickets t WHERE t.user_id=u.id) AS ticketCount
    FROM users u ORDER BY u.is_super_admin DESC,u.active DESC,LOWER(u.name)`);
  return NextResponse.json({ users: users.rows.map((user) => ({ ...user, id: Number(user.id), ticketCount: Number(user.ticketcount) })) });
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    const role = String(body.role || "staff");
    const department = String(body.department || "").trim();
    const jobTitle = String(body.jobTitle || "").trim();
    const location = String(body.location || "").trim();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || !["staff", "admin"].includes(role)) {
      return NextResponse.json({ error: "Provide a name, valid work email, staff/admin role, and password of at least 10 characters." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const db = await getDb();
    const result = await db.query(`INSERT INTO users (name,email,password_hash,role,department,job_title,location,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [name, email, bcrypt.hashSync(password, 12), role, department || null, jobTitle || null, location || null, now]);
    const id = Number(result.rows[0].id);
    await logActivity(actor, "created account", "user", id, `${role} account created for ${email}`);
    return NextResponse.json({ user: { id, name, email, role, department, jobTitle, location, active: true, isSuperAdmin: false, createdAt: now, ticketCount: 0 } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    return NextResponse.json({ error: "Unable to create account." }, { status: 500 });
  }
}
