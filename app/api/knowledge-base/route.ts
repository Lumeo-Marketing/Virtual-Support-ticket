import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb, logActivity } from "@/lib/db";

export const runtime = "nodejs";

const allowedTypes = new Set(["text", "pdf", "video", "youtube"]);
const maxVideoBytes = 50 * 1024 * 1024;
const maxPdfBytes = 20 * 1024 * 1024;

function normalizeYoutubeUrl(value: string) {
  const url = value.trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "youtu.be") return `https://www.youtube.com/watch?v=${parsed.pathname.slice(1)}`;
    if (parsed.hostname.includes("youtube.com")) return parsed.toString();
  } catch {
    // Accept only valid URLs.
  }
  return "";
}

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

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const db = await getDb();
  const rows = await db.query(`SELECT k.id,k.title,k.description,k.content_type,k.steps,k.youtube_url,k.file_name,k.file_size,k.created_at,k.updated_at,u.name AS created_by_name
    FROM knowledge_base k LEFT JOIN users u ON u.id = k.created_by ORDER BY k.created_at DESC`);

  return NextResponse.json({ entries: rows.rows.map(entryFromRow) });
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || (actor.role !== "admin" && !actor.isSuperAdmin)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });

  try {
    const form = await request.formData();
    const title = String(form.get("title") || "").trim();
    const description = String(form.get("description") || "").trim();
    const steps = String(form.get("steps") || "").trim();
    const contentType = String(form.get("contentType") || "").trim();
    const youtubeUrl = normalizeYoutubeUrl(String(form.get("youtubeUrl") || ""));

    if (!title) return NextResponse.json({ error: "Add a knowledge-base title." }, { status: 400 });
    if (!allowedTypes.has(contentType)) return NextResponse.json({ error: "Choose a valid content type." }, { status: 400 });
    if (title.length > 180 || description.length > 12000 || steps.length > 12000) return NextResponse.json({ error: "Your knowledge-base entry is too long." }, { status: 400 });
    if (contentType === "youtube" && !youtubeUrl) return NextResponse.json({ error: "Enter a valid YouTube URL." }, { status: 400 });

    const file = form.get("file");
    let fileName: string | null = null;
    let fileData: Buffer | null = null;
    let fileSize = 0;
    let fileContentType = contentType;

    if (file instanceof File && file.size > 0) {
      if (contentType === "pdf" && !file.type.includes("pdf")) return NextResponse.json({ error: "PDF entries must use a PDF file." }, { status: 400 });
      if (contentType === "video" && !["video/mp4", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"].includes(file.type)) return NextResponse.json({ error: "Video entries must use MP4, WebM, MOV, AVI, or MPEG." }, { status: 400 });
      if (contentType === "pdf" && file.size > maxPdfBytes) return NextResponse.json({ error: "PDF files must be 20 MB or smaller." }, { status: 400 });
      if (contentType === "video" && file.size > maxVideoBytes) return NextResponse.json({ error: "Video files must be 50 MB or smaller." }, { status: 400 });
      fileName = file.name;
      fileData = Buffer.from(await file.arrayBuffer());
      fileSize = file.size;
      if (contentType === "pdf" || contentType === "video") fileContentType = contentType;
    } else if (contentType === "pdf" || contentType === "video") {
      return NextResponse.json({ error: "Upload a PDF or video file for this content type." }, { status: 400 });
    }

    const db = await getDb();
    const result = await db.query(`INSERT INTO knowledge_base (title,description,content_type,steps,youtube_url,file_name,file_data,file_size,created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,title,description,content_type,steps,youtube_url,file_name,file_size,created_at,updated_at`,
    [title, description, fileContentType, steps, youtubeUrl || null, fileName, fileData, fileSize, actor.id]);
    const row = result.rows[0];
    await logActivity(actor, "created knowledge base", "knowledge_base", row.id, title);

    return NextResponse.json({ entry: entryFromRow(row) }, { status: 201 });
  } catch (error) {
    console.error("Knowledge-base creation failed", error);
    return NextResponse.json({ error: "Unable to create the knowledge-base entry." }, { status: 500 });
  }
}
