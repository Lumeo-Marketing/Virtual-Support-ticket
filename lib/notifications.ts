import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import { getDb, type TicketRecord, type UserRecord } from "@/lib/db";

export type TicketEmailDetails = Pick<TicketRecord,
  "id" | "ticketCode" | "fullName" | "workEmail" | "department" | "jobTitle" | "location" |
  "requestType" | "requestSubtype" | "category" | "priority" | "subject" | "description" |
  "attachmentName" | "status" | "resolution" | "createdAt" | "resolvedAt"
>;

const globalForMail = globalThis as unknown as { lumeoMailer?: Transporter };
const senderName = "Lumeo Virtual Ticket";

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

function mailer() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASSWORD) return null;
  if (!globalForMail.lumeoMailer) {
    globalForMail.lumeoMailer = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
      pool: true,
      maxConnections: 3,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
    });
  }
  return globalForMail.lumeoMailer;
}

function shell(title: string, preheader: string, body: string) {
  const safeTitle = escapeHtml(title);
  const safePreheader = escapeHtml(preheader);
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${safeTitle}</title></head><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#263346;-webkit-font-smoothing:antialiased"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${safePreheader}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #e8eaf0;border-radius:12px;overflow:hidden"><tr><td style="padding:22px 30px;background:#1d2a3c"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td style="font-size:18px;font-weight:800;letter-spacing:2px;color:#fff"><span style="color:#ffad4f">●</span>&nbsp; LUMEO</td><td align="right" style="font-size:10px;letter-spacing:1.3px;color:#c3ccd6">INTERNAL IT SUPPORT</td></tr></table></td></tr><tr><td style="height:4px;background:#f39a37;font-size:0;line-height:0">&nbsp;</td></tr><tr><td style="padding:30px">${body}<p style="margin:26px 0 0;padding-top:17px;border-top:1px solid #edf0f3;color:#84909d;font-size:11px;line-height:1.6">This message was sent by the LUMEO internal support workspace. Please do not reply directly to this automated email; use the support workspace to follow up.</p></td></tr></table><p style="margin:15px 0 0;color:#99a2ac;font-size:10px">© ${new Date().getFullYear()} LUMEO · Internal use only</p></td></tr></table></body></html>`;
}

function detailRows(ticket: TicketEmailDetails) {
  const fields = [
    ["Requester", ticket.fullName], ["Department", ticket.department], ["Request", `${ticket.requestType} · ${ticket.requestSubtype}`],
    ["Issue category", ticket.category], ["Priority", ticket.priority], ["Location", ticket.location],
  ];
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border-collapse:collapse">${fields.map(([label, value]) => `<tr><td width="38%" style="padding:9px 10px;border-bottom:1px solid #eef0f3;color:#7c8794;font-size:11px">${escapeHtml(label)}</td><td style="padding:9px 10px;border-bottom:1px solid #eef0f3;color:#2f3d4d;font-size:12px;font-weight:600">${escapeHtml(value)}</td></tr>`).join("")}</table>`;
}

function descriptionBlock(label: string, text: string) {
  return `<div style="margin-top:18px"><p style="margin:0 0 7px;color:#697584;font-size:10px;font-weight:700;letter-spacing:.8px;text-transform:uppercase">${escapeHtml(label)}</p><div style="padding:13px 14px;border:1px solid #ebedf0;border-radius:8px;background:#fafbfc;color:#465363;font-size:12px;line-height:1.65;white-space:pre-wrap">${escapeHtml(text)}</div></div>`;
}

function actionButton(label: string) {
  const url = `${(process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "")}/`;
  return `<p style="margin:22px 0 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 17px;border-radius:7px;background:#ef8b32;color:#fff;text-decoration:none;font-size:12px;font-weight:700">${escapeHtml(label)} &nbsp;→</a></p>`;
}

async function storeNotice(input: { userId: number; ticketId: number; ticketCode: string; status: string; message: string }) {
  const db = await getDb();
  await db.query("INSERT INTO notifications (user_id,ticket_id,title,message,created_at) VALUES ($1,$2,$3,$4,NOW())",
    [input.userId, input.ticketId, `${input.ticketCode} · ${input.status}`, input.message]);
}

async function deliver(options: SendMailOptions, context: string) {
  const transport = mailer();
  if (!transport) {
    console.info(`[support-email-not-configured] ${context}`);
    return;
  }
  try {
    const verifiedSender = process.env.SMTP_FROM || process.env.SMTP_USER;
    const result = await transport.sendMail({ from: `${senderName} <${verifiedSender}>`, ...options });
    // SMTP acceptance means queued by the provider; final delivery/bounce is confirmed in provider logs.
    console.info(`[support-email-accepted] ${context}; messageId=${result.messageId}; response=${result.response}`);
  } catch (error) {
    // Email transport outages must not undo a persisted ticket or resolution.
    console.error(`[support-email-failed] ${context}`, error instanceof Error ? error.message : "Unknown mail error");
  }
}

export async function notifyTicketCreated(input: { userId: number; ticket: TicketEmailDetails }) {
  const ticket = input.ticket;
  const confirmation = `We received your support request ${ticket.ticketCode}: ${ticket.subject}. The IT team has been notified and will keep you updated.`;
  await storeNotice({ userId: input.userId, ticketId: ticket.id, ticketCode: ticket.ticketCode, status: "Open", message: confirmation });

  const db = await getDb();
  const rows = await db.query(`SELECT email,is_super_admin AS "isSuperAdmin" FROM users WHERE active=TRUE AND role='admin' ORDER BY is_super_admin ASC,email`);
  const superAdminEmails = rows.rows.filter((row) => Boolean(row.isSuperAdmin)).map((row) => String(row.email).trim()).filter(Boolean);
  const extraAdminEmails = (process.env.SUPPORT_ADMIN_EMAILS || "").split(/[;,]/).map((email) => email.trim()).filter(Boolean);
  const superAdminSet = new Set(superAdminEmails.map((email) => email.toLowerCase()));
  const to = [...new Set([...rows.rows.filter((row) => !Boolean(row.isSuperAdmin)).map((row) => String(row.email).trim()), ...extraAdminEmails])]
    .filter((email) => email && !superAdminSet.has(email.toLowerCase()));
  const recipients = to.length ? to : superAdminEmails;
  const cc = to.length ? superAdminEmails : [];
  const adminTitle = `New support request ${ticket.ticketCode}`;
  const adminHtml = shell(adminTitle, `New ${ticket.priority} priority ${ticket.requestType.toLowerCase()} from ${ticket.fullName}.`,
    `<div style="display:inline-block;padding:5px 9px;border-radius:20px;background:#fff3e3;color:#b66b24;font-size:10px;font-weight:700;letter-spacing:.5px">NEW REQUEST&nbsp; · &nbsp;${escapeHtml(ticket.priority.toUpperCase())} PRIORITY</div><h1 style="margin:14px 0 7px;color:#202c3b;font-size:24px;line-height:1.25">${escapeHtml(ticket.subject)}</h1><p style="margin:0;color:#737f8d;font-size:12px">A new employee request is waiting in the IT support queue.</p><div style="margin-top:18px;padding:12px 14px;border-radius:8px;background:#f7f8fa"><span style="color:#7e8996;font-size:10px;text-transform:uppercase;letter-spacing:.6px">Ticket reference</span><div style="margin-top:4px;color:#b66f2c;font-size:15px;font-weight:700">${escapeHtml(ticket.ticketCode)}</div></div>${detailRows(ticket)}${descriptionBlock("Issue details", ticket.description)}${ticket.attachmentName ? `<p style="font-size:11px;color:#667382">Attachment included: <b>${escapeHtml(ticket.attachmentName)}</b> (available in the ticket workspace)</p>` : ""}${actionButton("Open ticket queue")}`);
  await deliver({ to: recipients, cc: cc.length ? cc : undefined, replyTo: ticket.workEmail, subject: `[${ticket.priority.toUpperCase()}] New ticket ${ticket.ticketCode}: ${ticket.subject}`, text: `${adminTitle}\nRequester: ${ticket.fullName} (${ticket.workEmail})\nDepartment: ${ticket.department}\nType: ${ticket.requestType} — ${ticket.requestSubtype}\nCategory: ${ticket.category}\nPriority: ${ticket.priority}\n\n${ticket.description}\n\nOpen the LUMEO support workspace to respond.`, html: adminHtml }, `new ticket ${ticket.ticketCode}; admin recipients=${recipients.length}; super-admin cc=${cc.length}`);

  const userTitle = `We received your request · ${ticket.ticketCode}`;
  const userHtml = shell(userTitle, `Your support request ${ticket.ticketCode} has been received.`,
    `<div style="width:42px;height:42px;line-height:42px;text-align:center;border-radius:50%;background:#eaf7f1;color:#25895e;font-size:22px;font-weight:bold">✓</div><h1 style="margin:16px 0 7px;color:#202c3b;font-size:23px">Request received, ${escapeHtml(ticket.fullName.split(" ")[0])}.</h1><p style="margin:0;color:#737f8d;font-size:12px;line-height:1.65">Your IT support request has been sent to our team. We will email you when there is an update.</p><div style="margin-top:19px;padding:14px;border:1px solid #f0dfca;border-radius:8px;background:#fffaf4"><span style="color:#8c7967;font-size:10px">YOUR TICKET</span><div style="margin-top:4px;color:#b66f2c;font-size:14px;font-weight:700">${escapeHtml(ticket.ticketCode)} · ${escapeHtml(ticket.subject)}</div><p style="margin:7px 0 0;color:#718091;font-size:11px">Current status: <b>${escapeHtml(ticket.status)}</b></p></div><p style="margin:18px 0 0;color:#677483;font-size:11px;line-height:1.6">You can follow progress and read the IT team&apos;s response by signing in to the support workspace.</p>${actionButton("View my request")}`);
  await deliver({ to: ticket.workEmail, replyTo: process.env.SUPPORT_REPLY_TO || process.env.SMTP_FROM || process.env.SMTP_USER, subject: `Request received ${ticket.ticketCode}: ${ticket.subject}`, text: confirmation, html: userHtml }, `request receipt ${ticket.ticketCode} to requester`);
}

export async function notifyTicketUpdate(input: { userId: number; ticket: TicketEmailDetails; previousStatus: string; actor: UserRecord }) {
  const { ticket } = input;
  const completed = ["Resolved", "Closed"].includes(ticket.status);
  const statusChanged = input.previousStatus !== ticket.status;
  const message = completed
    ? `Your support request ${ticket.ticketCode} has been marked ${ticket.status}. ${ticket.resolution ? `IT resolution: ${ticket.resolution}` : ""}`.trim()
    : `Your support request ${ticket.ticketCode} was updated${statusChanged ? ` to ${ticket.status}` : ""}. ${ticket.resolution ? `IT update: ${ticket.resolution}` : "The IT team will keep you updated."}`.trim();
  await storeNotice({ userId: input.userId, ticketId: ticket.id, ticketCode: ticket.ticketCode, status: ticket.status, message });

  const updateTitle = completed ? `Your request is ${ticket.status.toLowerCase()} · ${ticket.ticketCode}` : `IT support update · ${ticket.ticketCode}`;
  const color = completed ? "#23845b" : "#b66b24";
  const headline = completed ? `Your request is ${ticket.status.toLowerCase()}.` : "There is an update on your request.";
  const updateHtml = shell(updateTitle, `${ticket.ticketCode} · ${ticket.subject} · ${ticket.status}`,
    `<div style="display:inline-block;padding:5px 9px;border-radius:20px;background:${completed ? "#eaf7f1" : "#fff3e3"};color:${color};font-size:10px;font-weight:700;letter-spacing:.4px">${escapeHtml(ticket.status.toUpperCase())}</div><h1 style="margin:14px 0 7px;color:#202c3b;font-size:23px">${escapeHtml(headline)}</h1><p style="margin:0;color:#737f8d;font-size:12px;line-height:1.6">Hi ${escapeHtml(ticket.fullName.split(" ")[0])}, our IT support team has updated your request.</p><div style="margin-top:18px;padding:14px;border:1px solid #edf0f3;border-radius:8px"><span style="color:#8d98a4;font-size:10px">${escapeHtml(ticket.ticketCode)}</span><div style="margin-top:4px;color:#2f3d4d;font-size:14px;font-weight:700">${escapeHtml(ticket.subject)}</div><p style="margin:7px 0 0;color:#6f7c8a;font-size:11px">Updated by ${escapeHtml(input.actor.name)} · ${escapeHtml(input.actor.role === "superadmin" ? "Super Administrator" : "IT Support")}</p></div>${ticket.resolution ? descriptionBlock(completed ? "Resolution" : "IT team update", ticket.resolution) : ""}${completed ? `<p style="margin:17px 0 0;color:#647181;font-size:11px;line-height:1.6">If you still need help with this issue, reply to your IT team or submit a follow-up request.</p>` : `<p style="margin:17px 0 0;color:#647181;font-size:11px;line-height:1.6">We&apos;ll let you know when there are further updates. You can also follow your request in the support workspace.</p>`}${actionButton(completed ? "View resolution" : "View request")}`);
  await deliver({ to: ticket.workEmail, replyTo: process.env.SUPPORT_REPLY_TO || process.env.SMTP_FROM || process.env.SMTP_USER, subject: `${completed ? "Request " + ticket.status.toLowerCase() : "Support update"} ${ticket.ticketCode}: ${ticket.subject}`, text: message, html: updateHtml }, `ticket update ${ticket.ticketCode} to requester`);
}
