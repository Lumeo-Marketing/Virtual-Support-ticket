import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = (url.searchParams.get("status") || "").trim();
  const category = (url.searchParams.get("category") || "").trim();
  const priority = (url.searchParams.get("priority") || "").trim();
  const assignee = (url.searchParams.get("assignee") || "").trim();
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get("pageSize") || 25)));
  const exporting = url.searchParams.get("export") === "csv";
  const exportActivity = url.searchParams.get("export") === "activity-csv";

  const values: unknown[] = [];
  const clauses: string[] = [];
  const add = (sql: (parameter: string) => string, value: unknown) => {
    values.push(value);
    clauses.push(sql(`$${values.length}`));
  };
  if (q) add((p) => `(t.ticket_code ILIKE ${p} OR t.subject ILIKE ${p} OR t.full_name ILIKE ${p} OR t.work_email ILIKE ${p} OR COALESCE(a.name,'') ILIKE ${p} OR t.resolution ILIKE ${p})`, `%${q}%`);
  if (status) add((p) => `t.status=${p}`, status);
  if (category) add((p) => `t.category=${p}`, category);
  if (priority) add((p) => `t.priority=${p}`, priority);
  if (assignee) add((p) => `t.assigned_to=${p}`, Number(assignee));
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) add((p) => `t.created_at >= ${p}::date`, from);
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) add((p) => `t.created_at < (${p}::date + INTERVAL '1 day')`, to);
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const db = await getDb();
  const ticketSelect = `SELECT t.id,t.ticket_code AS "ticketCode",t.full_name AS "requesterName",t.work_email AS "requesterEmail",t.department,t.request_type AS "requestType",t.request_subtype AS "requestSubtype",t.category,t.priority,t.subject,t.status,t.created_at AS "createdAt",t.updated_at AS "updatedAt",t.resolved_at AS "resolvedAt",t.resolution,a.name AS "resolverName",a.email AS "resolverEmail",CASE WHEN t.resolved_at IS NOT NULL THEN ROUND((EXTRACT(EPOCH FROM (t.resolved_at-t.created_at))/3600)::numeric,2) ELSE NULL END AS "resolutionHours"
    FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to ${where}`;

  if (exportActivity) {
    const activityFilters: string[] = [];
    const activityValues: unknown[] = [];
    if (q) { activityValues.push(`%${q}%`); activityFilters.push(`(actor_name ILIKE $${activityValues.length} OR actor_email ILIKE $${activityValues.length} OR action ILIKE $${activityValues.length} OR details ILIKE $${activityValues.length})`); }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { activityValues.push(from); activityFilters.push(`created_at >= $${activityValues.length}::date`); }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { activityValues.push(to); activityFilters.push(`created_at < ($${activityValues.length}::date + INTERVAL '1 day')`); }
    const activityWhere = activityFilters.length ? `WHERE ${activityFilters.join(" AND ")}` : "";
    const result = await db.query(`SELECT actor_name,actor_email,actor_role,action,entity_type,entity_id,details,created_at FROM activity_events ${activityWhere} ORDER BY id DESC LIMIT 50000`, activityValues);
    const columns = ["Actor", "Email", "Role", "Action", "Entity", "Entity ID", "Details", "Time"];
    const rows = result.rows.map((event) => [event.actor_name,event.actor_email,event.actor_role,event.action,event.entity_type,event.entity_id,event.details,event.created_at].map(csvCell).join(","));
    return new Response(`\uFEFF${[columns.map(csvCell).join(","), ...rows].join("\r\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lumeo-activity-report-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "private, no-store" } });
  }
  if (exporting) {
    const result = await db.query(`${ticketSelect} ORDER BY t.created_at DESC LIMIT 50000`, values);
    const columns = ["Ticket ID", "Requester", "Requester Email", "Department", "Request Type", "Request Category", "Issue Category", "Priority", "Subject", "Status", "Created At", "Resolved At", "Resolution Hours", "Resolver", "Resolution"];
    const rows = result.rows.map((ticket) => [ticket.ticketCode,ticket.requesterName,ticket.requesterEmail,ticket.department,ticket.requestType,ticket.requestSubtype,ticket.category,ticket.priority,ticket.subject,ticket.status,ticket.createdAt,ticket.resolvedAt,ticket.resolutionHours,ticket.resolverName,ticket.resolution].map(csvCell).join(","));
    const csv = [columns.map(csvCell).join(","), ...rows].join("\r\n");
    return new Response(`\uFEFF${csv}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lumeo-support-report-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "private, no-store" } });
  }

  const countResult = await db.query(`SELECT COUNT(*)::int AS total,COUNT(*) FILTER (WHERE t.status NOT IN ('Resolved','Closed'))::int AS open,COUNT(*) FILTER (WHERE t.status IN ('Resolved','Closed'))::int AS resolved,COUNT(*) FILTER (WHERE t.priority IN ('Critical','High') AND t.status NOT IN ('Resolved','Closed'))::int AS urgent,ROUND((AVG(EXTRACT(EPOCH FROM (t.resolved_at-t.created_at))/3600) FILTER (WHERE t.resolved_at IS NOT NULL))::numeric,2) AS "averageResolutionHours",COUNT(*) FILTER (WHERE t.resolved_at IS NOT NULL AND t.resolved_at-t.created_at > INTERVAL '24 hours')::int AS "over24Hours" FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to ${where}`, values);
  const total = Number(countResult.rows[0].total);
  const offset = (page - 1) * pageSize;
  const pageValues = [...values, pageSize, offset];
  const ticketResult = await db.query(`${ticketSelect} ORDER BY t.created_at DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
  const statusResult = await db.query(`SELECT t.status AS label,COUNT(*)::int AS value FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to ${where} GROUP BY t.status ORDER BY value DESC`, values);
  const monthlyResult = await db.query(`SELECT TO_CHAR(DATE_TRUNC('month',t.created_at),'YYYY-MM') AS month,COUNT(*)::int AS opened,COUNT(*) FILTER (WHERE t.status IN ('Resolved','Closed'))::int AS resolved FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to ${where} GROUP BY DATE_TRUNC('month',t.created_at) ORDER BY DATE_TRUNC('month',t.created_at) DESC LIMIT 12`, values);
  const agentResult = await db.query(`SELECT a.id AS "agentId",COALESCE(a.name,'Unassigned') AS agent,COUNT(*)::int AS assigned,COUNT(*) FILTER (WHERE t.status IN ('Resolved','Closed'))::int AS resolved,ROUND((AVG(EXTRACT(EPOCH FROM (t.resolved_at-t.created_at))/3600) FILTER (WHERE t.resolved_at IS NOT NULL))::numeric,2) AS "averageResolutionHours" FROM tickets t LEFT JOIN users a ON a.id=t.assigned_to ${where} GROUP BY a.id,a.name ORDER BY resolved DESC,assigned DESC`, values);
  const owners = await db.query("SELECT id,name,email FROM users WHERE active=TRUE AND (role='admin' OR is_super_admin=TRUE) ORDER BY LOWER(name),LOWER(email)");
  const eventValues: unknown[] = [];
  const eventClauses: string[] = [];
  if (q) { eventValues.push(`%${q}%`); eventClauses.push(`(actor_name ILIKE $${eventValues.length} OR actor_email ILIKE $${eventValues.length} OR action ILIKE $${eventValues.length} OR details ILIKE $${eventValues.length})`); }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) { eventValues.push(from); eventClauses.push(`created_at >= $${eventValues.length}::date`); }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) { eventValues.push(to); eventClauses.push(`created_at < ($${eventValues.length}::date + INTERVAL '1 day')`); }
  const eventWhere = eventClauses.length ? `WHERE ${eventClauses.join(" AND ")}` : "";
  const activityPage = Math.max(1, Number(url.searchParams.get("activityPage") || 1));
  const activityCount = await db.query(`SELECT COUNT(*)::int AS total FROM activity_events ${eventWhere}`, eventValues);
  const activityParams = [...eventValues, pageSize, (activityPage - 1) * pageSize];
  const activity = await db.query(`SELECT id,actor_name AS "actorName",actor_email AS "actorEmail",actor_role AS "actorRole",action,entity_type AS "entityType",entity_id AS "entityId",details,created_at AS "createdAt" FROM activity_events ${eventWhere} ORDER BY id DESC LIMIT $${activityParams.length - 1} OFFSET $${activityParams.length}`, activityParams);

  return NextResponse.json({
    summary: { ...countResult.rows[0], total, open: Number(countResult.rows[0].open), resolved: Number(countResult.rows[0].resolved), urgent: Number(countResult.rows[0].urgent), over24Hours: Number(countResult.rows[0].over24Hours), averageResolutionHours: countResult.rows[0].averageResolutionHours === null ? null : Number(countResult.rows[0].averageResolutionHours) },
    tickets: ticketResult.rows.map((ticket) => ({ ...ticket, id: Number(ticket.id), resolutionHours: ticket.resolutionHours === null ? null : Number(ticket.resolutionHours) })),
    ticketPage: { page, pageSize, total, pageCount: Math.max(1, Math.ceil(total / pageSize)) },
    statusBreakdown: statusResult.rows,
    monthly: monthlyResult.rows.reverse(),
    agents: agentResult.rows.map((agent) => ({ ...agent, agentId: agent.agentId === null ? null : Number(agent.agentId), assigned: Number(agent.assigned), resolved: Number(agent.resolved), averageResolutionHours: agent.averageResolutionHours === null ? null : Number(agent.averageResolutionHours) })),
    owners: owners.rows.map((owner) => ({ id: Number(owner.id), name: String(owner.name), email: String(owner.email) })),
    activity: activity.rows,
    activityPage: { page: activityPage, pageSize, total: Number(activityCount.rows[0].total), pageCount: Math.max(1, Math.ceil(Number(activityCount.rows[0].total) / pageSize)) },
  });
}
