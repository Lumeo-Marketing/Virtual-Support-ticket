export function passwordValidationError(password: string) {
  if (password.length < 10) return "Use at least 10 characters for your password.";
  if (new TextEncoder().encode(password).length > 72) return "Use a password of at most 72 bytes (fewer characters if using emoji or accented letters).";
  return "";
}
