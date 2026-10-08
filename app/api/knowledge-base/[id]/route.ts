import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function entryFromRow(row: Record<string, unknown>) {
  return {
    id: Number(row.id),
    title: String(row.title),
    description: String(row.description || ""),
    contentType: String(row.content_type),
    steps: String(row.steps || ""),
    youtubeUrl: row.youtube_url ? String(row.youtube_url) : null,
    fileName: row.file_name ? String(row.file_name) : null,
    fileSize: row.file_size != null ? Number(row.file_size) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    createdBy: String(row.created_by_name || "System"),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { id } = await context.params;
  const db = await getDb();
  const result = await db.query(`SELECT k.id,k.title,k.description,k.content_type,k.steps,k.youtube_url,k.file_name,k.file_size,k.created_at,k.updated_at,u.name AS created_by_name
    FROM knowledge_base k LEFT JOIN users u ON u.id = k.created_by WHERE k.id = $1`, [Number(id)]);
  const entry = result.rows[0];
  if (!entry) return NextResponse.json({ error: "Knowledge-base entry was not found." }, { status: 404 });

  return NextResponse.json({ entry: entryFromRow(entry) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await getCurrentUser();
  if (!actor || (actor.role !== "admin" && !actor.isSuperAdmin)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

  const { id } = await context.params;
  const db = await getDb();
  const result = await db.query("DELETE FROM knowledge_base WHERE id = $1 RETURNING title", [Number(id)]);
  if (!result.rowCount) return NextResponse.json({ error: "Knowledge-base entry was not found." }, { status: 404 });
  return NextResponse.json({ success: true, deletedTitle: result.rows[0].title });
}
