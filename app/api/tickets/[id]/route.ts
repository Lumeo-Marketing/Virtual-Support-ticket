import { after, NextResponse } from "next/server";
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
  if (!row || (user.role === "staff" && Number(row.user_id) !== user.id && Number(row.assigned_to) !== user.id)) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  return NextResponse.json({ ticket: asTicket(row) });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role === "staff") return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  const { id } = await context.params;
  const db = await getDb();
  const priorResult = await db.query("SELECT id,ticket_code,user_id,work_email,status,resolution,resolved_at,subject,created_at,updated_at,assigned_to FROM tickets WHERE id=$1", [Number(id)]);
  const prior = priorResult.rows[0] as Record<string, unknown> | undefined;
  if (!prior) return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
  try {
    const body = await request.json();
    const status = String(body.status || prior.status) as TicketStatus;
    const resolution = typeof body.resolution === "string" ? body.resolution.trim().slice(0, 6000) : String(prior.resolution || "");
    if (!(STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: "Choose a valid status." }, { status: 400 });
    if (["Resolved", "Closed"].includes(status) && !resolution) return NextResponse.json({ error: "Add a resolution before resolving or closing a ticket." }, { status: 400 });
    const assignedTo = body.assignedTo === undefined ? (prior.assigned_to == null ? null : Number(prior.assigned_to)) : body.assignedTo;
    if (assignedTo !== null) {
      if (!Number.isSafeInteger(assignedTo) || assignedTo < 1) return NextResponse.json({ error: "Choose a valid assignee." }, { status: 400 });
      if (assignedTo !== Number(prior.assigned_to)) {
        const assignee = await db.query("SELECT id FROM users WHERE id=$1 AND active=TRUE", [assignedTo]);
        if (!assignee.rows.length) return NextResponse.json({ error: "Choose an active user to assign this ticket to." }, { status: 400 });
      }
    }
    if (status === "Escalated" && assignedTo === null) return NextResponse.json({ error: "Choose a user for this escalation." }, { status: 400 });
    const assignmentChanged = assignedTo !== (prior.assigned_to == null ? null : Number(prior.assigned_to));
    const now = new Date().toISOString();
    const resolvedAt = ["Resolved", "Closed"].includes(status) ? (prior.resolved_at as string | null) || now : null;
    const updated = await db.query(`UPDATE tickets SET status=$1,resolution=$2,updated_at=$3,resolved_at=$4,assigned_to=$5 WHERE id=$6
      RETURNING id,ticket_code,user_id,full_name,work_email,department,job_title,location,request_type,request_subtype,category,priority,subject,description,attachment_path,attachment_name,resolution,status,created_at,updated_at,resolved_at,assigned_to,
      (SELECT name FROM users WHERE users.id=tickets.assigned_to) AS assignee_name`, [status, resolution, now, resolvedAt, assignedTo, Number(id)]);
    const ticket = asTicket(updated.rows[0]);
    if (status !== prior.status || resolution !== prior.resolution || assignmentChanged) {
      // Return the committed update immediately; email transport must not delay saving.
      after(async () => {
        const results = await Promise.allSettled([
          logActivity(user, "updated ticket", "ticket", ticket.id, `${ticket.ticketCode}: ${prior.status} → ${status}${resolution !== prior.resolution ? "; resolution updated" : ""}${assignmentChanged ? `; assigned to ${assignedTo === null ? "unassigned" : ticket.assigneeName || assignedTo}` : ""}`),
          ...(prior.user_id == null ? [] : [notifyTicketUpdate({ userId: Number(prior.user_id), ticket, previousStatus: String(prior.status), actor: user })]),
          ...(assignmentChanged && assignedTo !== null ? [db.query("INSERT INTO notifications (user_id,ticket_id,title,message,created_at) VALUES ($1,$2,$3,$4,NOW())", [assignedTo, ticket.id, `${ticket.ticketCode} · Assigned to you`, `${user.name} assigned ${ticket.ticketCode}: ${ticket.subject} to you. Status: ${status}.`])] : []),
        ]);
        for (const result of results) {
          if (result.status === "rejected") console.error("Ticket saved but follow-up failed", result.reason instanceof Error ? result.reason.message : "Unknown error");
        }
      });
    }
    return NextResponse.json({ ticket });
  } catch {
    return NextResponse.json({ error: "Unable to update ticket." }, { status: 500 });
  }
}
