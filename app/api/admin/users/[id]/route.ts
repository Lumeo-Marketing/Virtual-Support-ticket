import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid account." }, { status: 400 });
  const db = await getDb();
  const result = await db.query("SELECT id,name,email,role,active,is_super_admin FROM users WHERE id=$1", [id]);
  const target = result.rows[0] as { id: number; name: string; email: string; role: string; active: boolean; is_super_admin: boolean } | undefined;
  if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (target.is_super_admin) return NextResponse.json({ error: "Super-admin accounts cannot be changed here." }, { status: 409 });
  try {
    const body = await request.json();
    if (typeof body.active === "boolean") {
      await db.query("UPDATE users SET active=$1 WHERE id=$2", [body.active, id]);
      await logActivity(actor, body.active ? "reactivated account" : "deactivated account", "user", id, `${target.email} access ${body.active ? "restored" : "revoked"}`);
    }
    if (body.role !== undefined) {
      if (!["staff", "admin"].includes(String(body.role))) return NextResponse.json({ error: "Role must be staff or admin." }, { status: 400 });
      await db.query("UPDATE users SET role=$1 WHERE id=$2", [body.role, id]);
      if (body.role !== target.role) await logActivity(actor, "changed account role", "user", id, `${target.email}: ${target.role} → ${body.role}`);
    }
    const updated = await db.query(`SELECT id,name,email,role,department,job_title AS "jobTitle",location,active,is_super_admin AS "isSuperAdmin",created_at AS "createdAt" FROM users WHERE id=$1`, [id]);
    return NextResponse.json({ user: { ...updated.rows[0], id: Number(updated.rows[0].id) } });
  } catch {
    return NextResponse.json({ error: "Unable to update account." }, { status: 500 });
  }
}
