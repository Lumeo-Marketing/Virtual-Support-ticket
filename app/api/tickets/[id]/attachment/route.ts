import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

const contentTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { id } = await context.params;
  const db = await getDb();
  const result = await db.query("SELECT user_id,attachment_name,attachment_data FROM tickets WHERE id=$1", [Number(id)]);
  const ticket = result.rows[0] as { user_id: string | number; attachment_name: string | null; attachment_data: Buffer | null } | undefined;
  if (!ticket || (user.role === "staff" && Number(ticket.user_id) !== user.id)) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  if (!ticket.attachment_data) return NextResponse.json({ error: "No attachment is available." }, { status: 404 });

  const name = ticket.attachment_name || "support-attachment";
  const extension = name.split(".").pop()?.toLowerCase() || "";
  const downloadName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return new Response(new Uint8Array(ticket.attachment_data), {
    headers: {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
