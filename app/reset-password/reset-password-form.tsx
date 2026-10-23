"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { Spinner } from "../alerts";
import { passwordValidationError } from "@/lib/passwords";

export default function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    void Promise.resolve().then(() => {
      setToken(new URLSearchParams(window.location.hash.slice(1)).get("token") || "");
      setReady(true);
    });
  }, []);
  const validLink = /^[a-f0-9]{64}$/.test(token);
  const mismatch = Boolean(confirmation && password !== confirmation);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const validation = passwordValidationError(password);
    if (validation) { setError(validation); return; }
    if (password !== confirmation) { setError("Passwords do not match."); return; }
    setError(""); setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password, confirmPassword: confirmation }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not reset your password.");
      setPassword(""); setConfirmation(""); setToken(""); setSuccess(true);
      window.history.replaceState(null, "", window.location.pathname);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reach the workspace. Please try again."); }
    finally { setBusy(false); }
  }
  return <main className="reset-password-screen"><div className="reset-password-brand"><Image src="/lumeo-symbol.svg" width={32} height={32} alt=""/><b>LUMEO</b><span>SUPPORT</span></div><section className="reset-password-card">
    <div className={`reset-password-symbol ${success ? "reset-password-success" : ""}`}>{success ? <Check size={26}/> : <LockKeyhole size={25}/>}</div>
    <span className="reset-password-kicker">{success ? "YOU’RE ALL SET" : "YOUR ACCOUNT, YOUR PASSWORD"}</span>
    <h1>{success ? "Your password is ready." : "Set your password."}</h1>
    <p>{success ? "Your temporary password has been replaced. Sign in with your new password to open your support workspace." : "Choose a password for your LUMEO account. Enter it twice to make sure it matches."}</p>
    {!ready ? <div className="reset-password-loading"><Spinner/>Preparing your password form…</div> : success ? <Link className="button button-primary reset-signin" href="/">Continue to sign in <ArrowRight size={16}/></Link> : !validLink ? <div className="reset-password-error" role="alert">This reset link is missing or invalid. Open the full link from your welcome email, or contact your administrator for help.</div> : <form onSubmit={submit} className="reset-password-form">
      <label htmlFor="new-password">Password<input id="new-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} maxLength={72} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} required disabled={busy}/><small>Use at least 10 characters.</small></label>
      <label htmlFor="confirm-password">Confirm password<input id="confirm-password" name="confirmPassword" type={showPassword ? "text" : "password"} autoComplete="new-password" minLength={10} maxLength={72} value={confirmation} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} aria-invalid={mismatch} aria-describedby={mismatch ? "password-mismatch" : undefined} required disabled={busy}/>{mismatch && <small id="password-mismatch" className="reset-password-mismatch">Passwords do not match yet.</small>}</label>
      <button type="button" className="reset-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-pressed={showPassword}>{showPassword ? "Hide passwords" : "Show passwords"}</button>
      {error && <div className="reset-password-error" role="alert">{error}</div>}
      <button type="submit" className="button button-primary" disabled={busy || !password || !confirmation || mismatch} aria-busy={busy}>{busy ? <Spinner/> : <Check size={16}/>} {busy ? "Saving password…" : "Save new password"}</button>
      <p className="reset-password-footnote">Your email link expires after 24 hours and can only be used once.</p>
    </form>}
  </section><p className="reset-password-footer">LUMEO · Private company workspace</p></main>;
}
