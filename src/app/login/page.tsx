"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface ApiResult {
  error: { message: string } | null;
}

export default function LoginPage() {
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [setupComplete, setSetupComplete] = useState(false);

  useEffect(() => {
    setSetupComplete(new URLSearchParams(window.location.search).get("setup") === "complete");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/patients/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: formData.get("username"),
          password: formData.get("password"),
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || result.error) {
        setError(result.error?.message ?? "Unable to sign in. Please try again.");
        return;
      }
      window.location.assign("/");
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
          <p className="story-kicker">Care, considered</p>
          <h1>A clearer view of your health.</h1>
          <p>Thoughtful medical perspectives, with your care at the center.</p>
        </div>
        <div className="story-foot">A second opinion, made more accessible</div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <Link className="auth-brand auth-mobile-brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            SecOpinion
          </Link>
          <p className="auth-eyebrow">Patient account</p>
          <h2>Welcome back</h2>
          <p className="auth-intro">Sign in to continue to your account.</p>
          {setupComplete && <p className="auth-success" role="status">Password set. Sign in to continue.</p>}
          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="field-group">
              <label htmlFor="username">Username</label>
              <input
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                minLength={3}
                maxLength={30}
                required
              />
            </div>
            <div className="field-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
          <p className="auth-switch">
            Verified by OTP but new to passwords? <Link href="/register/password">Set up your account</Link>
          </p>
        </div>
      </section>
    </main>
  );
}