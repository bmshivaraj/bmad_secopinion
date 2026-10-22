"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

interface ApiResult {
  data: { verificationStatus: string } | null;
  error: { message: string } | null;
}

export default function DoctorLoginPage() {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [verificationStatus, setVerificationStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/doctors/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to sign in. Please try again.");
        return;
      }
      setVerificationStatus(result.data.verificationStatus);
      setNotice(`Signed in. Verification status: ${result.data.verificationStatus}.`);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="SecOpinion">
        <Link className="auth-brand" href="/">
          <span className="brand-mark" aria-hidden="true">S</span>
          SecOpinion
        </Link>
        <div className="story-copy">
          <p className="story-kicker">Doctor account</p>
          <h1>Your expertise, ready when it matters.</h1>
          <p>Sign in to view your professional verification status.</p>
        </div>
        <div className="story-foot">A trusted perspective can change a decision</div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <Link className="auth-brand auth-mobile-brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            SecOpinion
          </Link>
          <p className="auth-eyebrow">Doctor account</p>
          <h2>Welcome back</h2>
          <p className="auth-intro">Sign in with your Doctor username and password.</p>
          {notice && <p className="auth-success" role="status">{notice} {verificationStatus === "Verified" && <Link href="/doctors/queue">Open Case queue</Link>} <Link href="/doctors/profile">Manage payout details</Link></p>}
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="username">Username</label>
              <input id="username" name="username" type="text" autoComplete="username" minLength={3} maxLength={30} required />
            </div>
            <div className="field-group">
              <label htmlFor="password">Password</label>
              <input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <p className="auth-switch">New to SecOpinion? <Link href="/doctors/register">Register as a Doctor</Link></p>
        </div>
      </section>
    </main>
  );
}