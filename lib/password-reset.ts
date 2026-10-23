import { createHash, randomBytes } from "node:crypto";

export function newPasswordReset() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashResetToken(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
}

export function hashResetToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newTemporaryPassword() {
  return randomBytes(18).toString("base64url");
}
