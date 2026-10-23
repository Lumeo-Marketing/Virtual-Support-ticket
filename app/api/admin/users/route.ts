import { after, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";
import { newPasswordReset, newTemporaryPassword } from "@/lib/password-reset";
import { passwordValidationError } from "@/lib/passwords";
import { notifyUserCreated } from "@/lib/notifications";

export async function GET() {
  const actor = await getCurrentUser();
  if (!actor || (actor.role !== "admin" && !actor.isSuperAdmin)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const db = await getDb();
  const users = await db.query(`SELECT u.id,u.name,u.email,u.role,u.department,u.job_title AS "jobTitle",u.location,u.active,u.is_super_admin AS "isSuperAdmin",u.created_at AS "createdAt",
      (SELECT COUNT(*) FROM tickets t WHERE t.user_id=u.id) AS ticketCount
    FROM users u ORDER BY u.is_super_admin DESC,u.active DESC,LOWER(u.name)`);
  return NextResponse.json({ users: users.rows.map((user) => ({ ...user, id: Number(user.id), isSuperAdmin: Boolean(user.isSuperAdmin) || String(user.email).toLowerCase() === "godwin@lumeomarketing.com", ticketCount: Number(user.ticketcount) })) });
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || (actor.role !== "admin" && !actor.isSuperAdmin)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  try {
    const body = await request.json();
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const password = typeof body.password === "string" && body.password ? body.password : newTemporaryPassword();
    const requestedRole = String(body.role || "staff");
    const isSuperAdmin = requestedRole === "superadmin" || body.isSuperAdmin === true;
    const role = requestedRole === "superadmin" ? "admin" : requestedRole;
    const department = String(body.department || "").trim();
    const jobTitle = String(body.jobTitle || "").trim();
    const location = String(body.location || "").trim();
    if (!actor.isSuperAdmin && (isSuperAdmin || email === "godwin@lumeomarketing.com")) return NextResponse.json({ error: "Only the super administrator can create a super administrator." }, { status: 403 });
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || Boolean(passwordValidationError(password)) || !["staff", "admin"].includes(role)) {
      return NextResponse.json({ error: "Provide a name, valid work email, staff/admin role, and password of at least 10 characters." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const db = await getDb();
    const passwordHash = await bcrypt.hash(password, 12);
    const reset = newPasswordReset();
    const client = await db.connect();
    let id: number;
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO users (name,email,password_hash,role,department,job_title,location,is_super_admin,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [name, email, passwordHash, role, department || null, jobTitle || null, location || null, isSuperAdmin, now]);
      id = Number(result.rows[0].id);
      await client.query(`INSERT INTO password_reset_tokens (token_hash,user_id,email_at_issue,password_hash_at_issue,expires_at) VALUES ($1,$2,$3,$4,$5)`, [reset.tokenHash, id, email, passwordHash, reset.expiresAt]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    after(async () => {
      const results = await Promise.allSettled([
        logActivity(actor, "created account", "user", id, `${isSuperAdmin ? "super-admin" : role} account created for ${email}`),
        notifyUserCreated({ name, email, temporaryPassword: password, resetToken: reset.token }),
      ]);
      for (const result of results) {
        if (result.status === "rejected") console.error("Account created but follow-up failed");
      }
    });
    return NextResponse.json({ user: { id, name, email, role, department, jobTitle, location, active: true, isSuperAdmin, createdAt: now, ticketCount: 0 } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    return NextResponse.json({ error: "Unable to create account." }, { status: 500 });
  }
}
