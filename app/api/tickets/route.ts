import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { asTicket, getDb, logActivity } from "@/lib/db";
import { CATEGORIES, PRIORITIES, REQUEST_OPTIONS } from "@/lib/constants";
import { notifyTicketCreated } from "@/lib/notifications";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  const sql = `SELECT t.id,t.ticket_code,t.user_id,t.full_name,t.work_email,t.department,t.job_title,t.location,t.request_type,t.request_subtype,t.category,t.priority,t.subject,t.description,t.attachment_path,t.attachment_name,t.resolution,t.status,t.created_at,t.updated_at,t.resolved_at,t.assigned_to,u.name AS assignee_name
    FROM tickets t LEFT JOIN users u ON u.id=t.assigned_to ${user.role !== "staff" ? "" : "WHERE t.user_id=$1"} ORDER BY t.id DESC`;
  const rows = await db.query(sql, user.role !== "staff" ? [] : [user.id]);
  return NextResponse.json({ tickets: rows.rows.map(asTicket) });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  try {
    const form = await request.formData();
    const text = (key: string) => String(form.get(key) || "").trim();
    const required = ["fullName", "workEmail", "department", "jobTitle", "location", "requestType", "requestSubtype", "category", "priority", "subject", "description"];
    if (required.some((key) => !text(key))) return NextResponse.json({ error: "Complete all required fields." }, { status: 400 });
    const requestType = text("requestType");
    if (!REQUEST_OPTIONS[requestType]?.includes(text("requestSubtype"))) return NextResponse.json({ error: "Choose a valid request type." }, { status: 400 });
    if (!(CATEGORIES as readonly string[]).includes(text("category")) || !(PRIORITIES as readonly string[]).includes(text("priority"))) return NextResponse.json({ error: "Choose a valid category and priority." }, { status: 400 });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text("workEmail"))) return NextResponse.json({ error: "Enter a valid work email." }, { status: 400 });
    if (text("subject").length > 160 || text("description").length > 6000) return NextResponse.json({ error: "Subject or description is too long." }, { status: 400 });

    let attachmentPath: string | null = null;
    let attachmentName: string | null = null;
    let attachmentData: Buffer | null = null;
    const file = form.get("attachment");
    if (file instanceof File && file.size > 0) {
      if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: "Attachment must be 8 MB or smaller." }, { status: 400 });
      const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf", "text/plain"];
      if (!allowed.includes(file.type)) return NextResponse.json({ error: "Attach a PNG, JPG, WEBP, PDF, or TXT file." }, { status: 400 });
      attachmentData = Buffer.from(await file.arrayBuffer());
      attachmentName = file.name;
    }

    const db = await getDb();
    const client = await db.connect();
    let ticket: ReturnType<typeof asTicket>;
    try {
      await client.query("BEGIN");
      const result = await client.query(`INSERT INTO tickets (user_id,full_name,work_email,department,job_title,location,request_type,request_subtype,category,priority,subject,description,attachment_path,attachment_name,attachment_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [user.id, text("fullName"), text("workEmail"), text("department"), text("jobTitle"), text("location"), requestType, text("requestSubtype"), text("category"), text("priority"), text("subject"), text("description"), attachmentPath, attachmentName, attachmentData]);
      const id = Number(result.rows[0].id);
      const ticketCode = `LUM-${new Date().getFullYear()}-${String(id).padStart(5, "0")}`;
      await client.query("UPDATE tickets SET ticket_code=$1 WHERE id=$2", [ticketCode, id]);
      const row = await client.query(`SELECT id,ticket_code,user_id,full_name,work_email,department,job_title,location,request_type,request_subtype,category,priority,subject,description,attachment_path,attachment_name,resolution,status,created_at,updated_at,resolved_at,assigned_to FROM tickets WHERE id=$1`, [id]);
      ticket = asTicket(row.rows[0]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await logActivity(user, "submitted ticket", "ticket", ticket.id, `${ticket.ticketCode}: ${ticket.subject}`);
    try {
      await notifyTicketCreated({ userId: user.id, ticket });
    } catch (error) {
      // Ticket is committed already; mail or notification failures must not hide the saved request.
      console.error("Ticket email/notification workflow failed", error instanceof Error ? error.message : "Unknown notification error");
    }
    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    console.error("Ticket submission failed", error);
    return NextResponse.json({ error: "Unable to submit ticket. Please try again." }, { status: 500 });
  }
}
