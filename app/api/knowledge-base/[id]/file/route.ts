import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  pdf: "application/pdf",
  video: "application/octet-stream",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  avi: "video/x-msvideo",
  mpeg: "video/mpeg",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const { id } = await context.params;
  const db = await getDb();
  const result = await db.query("SELECT file_name,file_data,content_type FROM knowledge_base WHERE id = $1", [Number(id)]);
  const entry = result.rows[0] as { file_name: string | null; file_data: Buffer | null; content_type: string } | undefined;
  if (!entry || !entry.file_data) return NextResponse.json({ error: "File not found." }, { status: 404 });

  const extension = (entry.file_name || "").split(".").pop()?.toLowerCase() || "";
  const mediaType = contentTypes[extension] || contentTypes[entry.content_type] || "application/octet-stream";
  const downloadName = (entry.file_name || "knowledge-base-file").replace(/[^a-zA-Z0-9._-]/g, "_");

  return new Response(new Uint8Array(entry.file_data), {
    headers: {
      "Content-Type": mediaType,
      "Content-Disposition": `inline; filename="${downloadName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
