import { NextResponse } from "next/server";
import { authenticate, createSession } from "@/lib/auth";
import { logActivity } from "@/lib/db";

export async function POST(request: Request) {
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL is not configured. Set DATABASE_URL in .env.local and restart the app." }, { status: 503 });
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string") return NextResponse.json({ error: "Enter your work email and password." }, { status: 400 });
    const user = await authenticate(email, password);
    if (!user) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    await createSession(user);
    await logActivity(user, "signed in", "session", user.id, "Successful sign in");
    return NextResponse.json({ user });
  } catch {
    return NextResponse.json({ error: "Unable to sign in. Please try again." }, { status: 500 });
  }
}
