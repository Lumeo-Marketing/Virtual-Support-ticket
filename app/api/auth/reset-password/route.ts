import { after, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { asUser, getDb, logActivity } from "@/lib/db";
import { hashResetToken } from "@/lib/password-reset";
import { passwordValidationError } from "@/lib/passwords";

export const runtime = "nodejs";
const invalidLink = "This reset link is invalid, expired, or has already been used. Contact your administrator for help.";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const confirmation = typeof body?.confirmPassword === "string" ? body.confirmPassword : "";
  if (!/^[a-f0-9]{64}$/.test(token)) return NextResponse.json({ error: invalidLink }, { status: 400 });
  const passwordError = passwordValidationError(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });
  if (password !== confirmation) return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });

  try {
    const db = await getDb();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`SELECT u.* FROM password_reset_tokens p JOIN users u ON u.id=p.user_id
        WHERE p.token_hash=$1 AND p.expires_at>NOW() AND u.active=TRUE
          AND p.password_hash_at_issue=u.password_hash AND p.email_at_issue=u.email
        FOR UPDATE OF p,u`, [hashResetToken(token)]);
      const row = result.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: invalidLink }, { status: 400 });
      }
      if (await bcrypt.compare(password, String(row.password_hash))) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Choose a new password different from your temporary password." }, { status: 400 });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query("UPDATE users SET password_hash=$1,session_version=session_version+1 WHERE id=$2", [passwordHash, Number(row.id)]);
      await client.query("DELETE FROM password_reset_tokens WHERE user_id=$1", [Number(row.id)]);
      await client.query("COMMIT");
      const user = asUser(row);
      after(async () => {
        try { await logActivity(user, "reset account password", "user", user.id, "Password set using an email link"); }
        catch { console.error("Password changed but audit logging failed"); }
      });
      return NextResponse.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch {
    return NextResponse.json({ error: "Unable to reset your password. Please try again." }, { status: 500 });
  }
}
