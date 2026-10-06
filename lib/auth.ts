import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getDb, asUser, type UserRecord } from "@/lib/db";
import bcrypt from "bcryptjs";

const COOKIE = "lumeo_session";
const secret = new TextEncoder().encode(process.env.SESSION_SECRET || "development-only-change-me-before-deploying-portal");

export async function createSession(user: UserRecord) {
  const token = await new SignJWT({ sub: String(user.id), role: user.role, name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(secret);
  const jar = await cookies();
  jar.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12 });
}

export async function destroySession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getCurrentUser(): Promise<UserRecord | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret);
    const db = await getDb();
    const result = await db.query("SELECT * FROM users WHERE id = $1", [Number(payload.sub)]);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const user = asUser(row);
    return user.active ? user : null;
  } catch {
    return null;
  }
}

export async function authenticate(email: string, password: string) {
  const db = await getDb();
  const result = await db.query("SELECT * FROM users WHERE LOWER(email)=LOWER($1)", [email.trim()]);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row || !Boolean(row.active ?? true) || !bcrypt.compareSync(password, String(row.password_hash))) return null;
  return asUser(row);
}
