import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || (actor.role !== "admin" && !actor.isSuperAdmin)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid account." }, { status: 400 });
  const db = await getDb();
  const result = await db.query("SELECT id,name,email,role,department,job_title AS \"jobTitle\",location,active,is_super_admin AS \"isSuperAdmin\" FROM users WHERE id=$1", [id]);
  const target = result.rows[0] as { id: number; name: string; email: string; role: string; department: string | null; jobTitle: string | null; location: string | null; active: boolean; isSuperAdmin: boolean } | undefined;
  if (!target) return NextResponse.json({ error: "Account not found." }, { status: 404 });
  if (!actor.isSuperAdmin && (target.isSuperAdmin || target.email.toLowerCase() === "godwin@lumeomarketing.com")) return NextResponse.json({ error: "Super-admin accounts cannot be changed here." }, { status: 409 });
  const canManageAccountState = actor.isSuperAdmin;
  try {
    const body = await request.json();
    const nextName = typeof body.name === "string" ? body.name.trim() : target.name;
    const nextEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : target.email;
    const requestedRole = typeof body.role === "string" ? body.role : (target.isSuperAdmin ? "superadmin" : target.role);
    const nextSuperAdmin = requestedRole === "superadmin";
    const nextRole = nextSuperAdmin ? "admin" : requestedRole;
    const nextDepartment = typeof body.department === "string" ? body.department.trim() : target.department || null;
    const nextJobTitle = typeof body.jobTitle === "string" ? body.jobTitle.trim() : target.jobTitle || null;
    const nextLocation = typeof body.location === "string" ? body.location.trim() : target.location || null;
    const nextActive = canManageAccountState && typeof body.active === "boolean" ? body.active : target.active;
    const rawPassword = typeof body.password === "string" ? body.password : "";

    if (nextName.length < 2) return NextResponse.json({ error: "Name must be at least 2 characters." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });
    if (!canManageAccountState && (nextRole !== target.role || nextSuperAdmin !== target.isSuperAdmin)) return NextResponse.json({ error: "Only super administrators can change roles." }, { status: 403 });
    if (!["staff", "admin", "superadmin"].includes(requestedRole)) return NextResponse.json({ error: "Role must be staff, admin, or superadmin." }, { status: 400 });
    if (!canManageAccountState && typeof body.active !== "undefined") return NextResponse.json({ error: "Only super administrators can activate or deactivate accounts." }, { status: 403 });
    if (rawPassword && rawPassword.length < 10) return NextResponse.json({ error: "Password must be at least 10 characters." }, { status: 400 });

    if (!actor.isSuperAdmin && nextEmail === "godwin@lumeomarketing.com") return NextResponse.json({ error: "Only super administrators can assign this email." }, { status: 403 });

    const updates: string[] = [];
    const values: unknown[] = [];
    const changes: string[] = [];

    if (nextName !== target.name) { updates.push("name=$" + (values.length + 1)); values.push(nextName); changes.push(`name: ${target.name} → ${nextName}`); }
    if (nextEmail !== target.email) { updates.push("email=$" + (values.length + 1)); values.push(nextEmail); changes.push(`email: ${target.email} → ${nextEmail}`); }
    if (nextSuperAdmin !== target.isSuperAdmin) { updates.push("is_super_admin=$" + (values.length + 1)); values.push(nextSuperAdmin); changes.push(`role: super administrator ${nextSuperAdmin ? "granted" : "removed"}`); }
    if (nextRole !== target.role) { updates.push("role=$" + (values.length + 1)); values.push(nextRole); changes.push(`role: ${target.role} → ${nextRole}`); }
    if ((nextDepartment ?? null) !== (target.department ?? null)) { updates.push("department=$" + (values.length + 1)); values.push(nextDepartment); changes.push(`department: ${target.department || "—"} → ${nextDepartment || "—"}`); }
    if ((nextJobTitle ?? null) !== (target.jobTitle ?? null)) { updates.push("job_title=$" + (values.length + 1)); values.push(nextJobTitle); changes.push(`job title: ${target.jobTitle || "—"} → ${nextJobTitle || "—"}`); }
    if ((nextLocation ?? null) !== (target.location ?? null)) { updates.push("location=$" + (values.length + 1)); values.push(nextLocation); changes.push(`location: ${target.location || "—"} → ${nextLocation || "—"}`); }
    if (nextActive !== target.active) { updates.push("active=$" + (values.length + 1)); values.push(nextActive); changes.push(`status: ${target.active ? "active" : "inactive"} → ${nextActive ? "active" : "inactive"}`); }
    if (rawPassword) {
      updates.push("password_hash=$" + (values.length + 1)); values.push(bcrypt.hashSync(rawPassword, 12));
      changes.push("password: changed");
    }

    if (!updates.length) return NextResponse.json({ error: "No account changes were provided." }, { status: 400 });
    await db.query(`UPDATE users SET ${updates.join(", ")} WHERE id=$${values.length + 1}`, [...values, id]);

    for (const change of changes) await logActivity(actor, change.includes("password") ? "changed account password" : change.startsWith("status") ? "changed account status" : change.startsWith("role") ? "changed account role" : "updated account details", "user", id, `${target.email}: ${change}`);

    const updated = await db.query(`SELECT id,name,email,role,department,job_title AS "jobTitle",location,active,is_super_admin AS "isSuperAdmin",created_at AS "createdAt" FROM users WHERE id=$1`, [id]);
    return NextResponse.json({ user: { ...updated.rows[0], id: Number(updated.rows[0].id) } });
  } catch (error) {
    if (error instanceof Error && /duplicate key|already exists/i.test(error.message)) return NextResponse.json({ error: "That work email is already assigned to another account." }, { status: 409 });
    return NextResponse.json({ error: "Unable to update account." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Invalid account." }, { status: 400 });
  const db = await getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query("SELECT name,email FROM users WHERE id=$1 FOR UPDATE", [id]);
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }
    const target = result.rows[0];
    await client.query("UPDATE tickets SET user_id=NULL WHERE user_id=$1", [id]);
    await client.query("UPDATE tickets SET assigned_to=NULL WHERE assigned_to=$1", [id]);
    await client.query("UPDATE knowledge_base SET created_by=NULL WHERE created_by=$1", [id]);
    await client.query("DELETE FROM notifications WHERE user_id=$1", [id]);
    await client.query("DELETE FROM messages WHERE sender_id=$1 OR recipient_id=$1", [id]);
    await client.query("DELETE FROM users WHERE id=$1", [id]);
    await client.query(`INSERT INTO activity_events (actor_id,actor_name,actor_email,actor_role,action,entity_type,entity_id,details)
      VALUES ($1,$2,$3,$4,'deleted account','user',$5,$6)`,
    [actor.id, actor.name, actor.email, actor.role, String(id), `Deleted ${target.name} (${target.email}); ticket, guide, and audit history retained.`]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true });
  } catch {
    await client.query("ROLLBACK");
    return NextResponse.json({ error: "Unable to delete account." }, { status: 500 });
  } finally {
    client.release();
  }
}
