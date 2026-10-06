import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  const rows = await db.query(`SELECT id,title,message,created_at AS "createdAt",read_at AS "readAt" FROM notifications WHERE user_id=$1 ORDER BY id DESC LIMIT 8`, [user.id]);
  const unread = await db.query("SELECT COUNT(*) AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL", [user.id]);
  return NextResponse.json({ notifications: rows.rows, unread: Number(unread.rows[0].count) });
}

export async function PATCH() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const db = await getDb();
  await db.query("UPDATE notifications SET read_at=$1 WHERE user_id=$2 AND read_at IS NULL", [new Date().toISOString(), user.id]);
  return NextResponse.json({ ok: true });
}
