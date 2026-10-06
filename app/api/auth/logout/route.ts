import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth";
import { logActivity } from "@/lib/db";

export async function POST() {
  const user = await getCurrentUser();
  if (user) await logActivity(user, "signed out", "session", user.id, "User signed out");
  await destroySession();
  return NextResponse.json({ ok: true });
}
