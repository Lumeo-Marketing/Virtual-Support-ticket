import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { asTicket, getDb, logActivity, type TicketStatus } from "@/lib/db";
import { notifyTicketUpdate } from "@/lib/notifications";
import { STATUSES } from "@/lib/constants";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const db = await getDb();
  const result = await db.query(`SELECT t.id,t.ticket_code,t.user_id,t.full_name,t.work_email,t.department,t.job_title,t.location,t.request_type,t.request_subtype,t.category,t.priority,t.subject,t.description,t.attachment_path,t.attachment_name,t.resolution,t.status,t.created_at,t.updated_at,t.resolved_at,t.assigned_to,u.name AS assignee_name FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.id=$1`, [Number(id)]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || (user.role === "staff" && Number(row.user_id) !== user.id)) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  return NextResponse.json({ ticket: asTicket(row) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role === "staff") return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const { id } = await context.params;
  const db = await getDb();
  const priorResult = await db.query("SELECT id,ticket_code,user_id,work_email,status,resolution,resolved_at,subject,created_at,updated_at FROM tickets WHERE id=$1", [Number(id)]);
  const prior = priorResult.rows[0] as Record<string, unknown> | undefined;
  if (!prior) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  try {
    const body = await request.json();
    const status = String(body.status || prior.status) as TicketStatus;
    const resolution = typeof body.resolution === "string" ? body.resolution.trim().slice(0, 6000) : String(prior.resolution || "");
    if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Choose a valid status." }, { status: 400 });
    if (["Resolved", "Closed"].includes(status) && !resolution) return NextResponse.json({ error: "Add a resolution before resolving or closing a ticket." }, { status: 400 });
    const now = new Date().toISOString();
    const resolvedAt = ["Resolved", "Closed"].includes(status) ? (prior.resolved_at as string | null) || now : null;
    await db.query("UPDATE tickets SET status=$1,resolution=$2,updated_at=$3,resolved_at=$4,assigned_to=$5 WHERE id=$6", [status, resolution, now, resolvedAt, user.id, Number(id)]);
    const updated = await db.query("SELECT id,ticket_code,user_id,full_name,work_email,department,job_title,location,request_type,request_subtype,category,priority,subject,description,attachment_path,attachment_name,resolution,status,created_at,updated_at,resolved_at,assigned_to FROM tickets WHERE id=$1", [Number(id)]);
    const row = updated.rows[0] as Record<string, unknown>;
    const ticket = asTicket(row);
    if (status !== prior.status || resolution !== prior.resolution) {
      await logActivity(user, "updated ticket", "ticket", ticket.id, `${ticket.ticketCode}: ${prior.status} → ${status}${resolution ? `; resolution updated` : ""}`);
      await notifyTicketUpdate({ userId: Number(prior.user_id), ticket, previousStatus: String(prior.status), actor: user });
    }
    return NextResponse.json({ ticket });
  } catch {
    return NextResponse.json({ error: "Unable to update ticket." }, { status: 500 });
  }
}
