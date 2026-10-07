import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";
import { notifyMessage } from "@/lib/notifications";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = await getDb();
  const rows = await db.query(`SELECT m.id,m.sender_id AS "senderId",m.recipient_id AS "recipientId",m.content,m.read_at AS "readAt",m.created_at AS "createdAt",
      s.name AS "senderName",s.email AS "senderEmail",s.role AS "senderRole",s.is_super_admin AS "senderIsSuperAdmin",
      r.name AS "recipientName",r.email AS "recipientEmail",r.role AS "recipientRole",r.is_super_admin AS "recipientIsSuperAdmin",r.active AS "recipientActive",s.active AS "senderActive"
    FROM messages m
    JOIN users s ON s.id=m.sender_id
    JOIN users r ON r.id=m.recipient_id
    WHERE m.sender_id=$1 OR m.recipient_id=$1
    ORDER BY m.created_at DESC,m.id DESC`, [user.id]);
  const recipients = await db.query(`SELECT id,name,email,role,active,is_super_admin AS "isSuperAdmin"
    FROM users WHERE active=TRUE AND id<>$1 ORDER BY LOWER(name)`, [user.id]);

  return NextResponse.json({ messages: rows.rows.map((row) => ({
    ...row,
    id: Number(row.id), senderId: Number(row.senderId), recipientId: Number(row.recipientId),
  })), recipients: recipients.rows.map((row) => ({
    ...row, id: Number(row.id), isSuperAdmin: Boolean(row.isSuperAdmin), active: Boolean(row.active),
  })) });
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = await request.json();
  const recipientId = Number(body.recipientId);
  const content = String(body.content || "").trim();
  if (!Number.isInteger(recipientId) || recipientId < 1 || content.length < 1 || content.length > 5000) {
    return NextResponse.json({ error: "Enter a message between 1 and 5,000 characters." }, { status: 400 });
  }

  const db = await getDb();
  const recipient = await db.query(`SELECT id,name,email,role,active,is_super_admin AS "isSuperAdmin" FROM users WHERE id=$1`, [recipientId]);
  const target = recipient.rows[0];
  if (recipientId === actor.id) return NextResponse.json({ error: "Choose another team member." }, { status: 400 });
  if (!target || !Boolean(target.active)) return NextResponse.json({ error: "That user is not available." }, { status: 404 });

  const result = await db.query(`INSERT INTO messages (sender_id,recipient_id,content,created_at)
    VALUES ($1,$2,$3,NOW()) RETURNING id,created_at AS "createdAt"`, [actor.id, recipientId, content]);
  const message = result.rows[0];
  await logActivity(actor, "sent message", "message", message.id, `Message sent to ${target.name}`);
  await notifyMessage({
    recipientId: Number(target.id),
    recipientEmail: String(target.email),
    senderName: actor.name,
    senderRole: actor.isSuperAdmin ? "Super administrator" : actor.role === "admin" ? "IT administrator" : "Staff member",
    content,
  });

  return NextResponse.json({ message: { id: Number(message.id), senderId: actor.id, recipientId, content, createdAt: message.createdAt } }, { status: 201 });
}

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const senderId = Number(body?.senderId);
  const throughId = Number(body?.throughId);
  if (!Number.isSafeInteger(senderId) || senderId < 1 || !Number.isSafeInteger(throughId) || throughId < 1) {
    return NextResponse.json({ error: "Choose a conversation to mark as read." }, { status: 400 });
  }
  const db = await getDb();
  const result = await db.query(`UPDATE messages SET read_at=NOW()
    WHERE recipient_id=$1 AND sender_id=$2 AND id<=$3 AND read_at IS NULL
    RETURNING id,read_at AS "readAt"`, [user.id, senderId, throughId]);
  return NextResponse.json({ ids: result.rows.map((row) => Number(row.id)), readAt: result.rows[0]?.readAt ?? null });
}
