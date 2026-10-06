import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(request: Request) {
  const actor = await getCurrentUser();
  if (!actor?.isSuperAdmin) return NextResponse.json({ error: "Super administrator access required." }, { status: 403 });
  const url = new URL(request.url);
  const search = (url.searchParams.get("q") || "").trim();
  const db = await getDb();
  const events = await db.query(`SELECT id,actor_id AS "actorId",actor_name AS "actorName",actor_email AS "actorEmail",actor_role AS "actorRole",
      action,entity_type AS "entityType",entity_id AS "entityId",details,created_at AS "createdAt"
    FROM activity_events
    WHERE ($1='' OR actor_name ILIKE $2 OR actor_email ILIKE $2 OR action ILIKE $2 OR details ILIKE $2)
    ORDER BY id DESC LIMIT 10000`, [search, `%${search}%`]);
  return NextResponse.json({ events: events.rows });
}
