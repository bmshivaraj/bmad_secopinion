"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

interface ApiResult {
  error: { message: string } | null;
}

export default function PasswordSetupPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMinor, setIsMinor] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const username = String(formData.get("username") ?? "");
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");
    const declaresMinor = formData.get("isMinor") === "on";
    if (password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/patients/password/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username,
          password,
          isMinor: declaresMinor,
          ...(declaresMinor && {
            minorName: String(formData.get("minorName") ?? ""),
            guardianRelationship: String(formData.get("guardianRelationship") ?? ""),
            authorityAttested: formData.get("authorityAttested") === "on",
          }),
        }),
      });
      const result = await response.json() as ApiResult;
      if (!response.ok || result.error) {
        setError(result.error?.message ?? "Unable to set up your account. Please try again.");
        return;
      }
      router.replace("/login?setup=complete");
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
          <p className="story-kicker">Your care, in focus</p>
          <h1>Make space for a second perspective.</h1>
          <p>Secure access to the medical guidance you need.</p>
        </div>
        <div className="story-foot">Thoughtful care starts with trust</div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <Link className="auth-brand auth-mobile-brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            SecOpinion
          </Link>
          <p className="auth-eyebrow">Patient account</p>
          <h2>Set your password</h2>
          <p className="auth-intro">Choose a username and password for your account.</p>
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
                pattern="[A-Za-z0-9_]{3,30}"
                title="Use 3-30 letters, numbers, or underscores."
                required
              />
              <span className="field-hint">3-30 letters, numbers, or underscores.</span>
            </div>
            <div className="field-group">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={1024}
                pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}"
                title="Use at least 8 characters with uppercase, lowercase, and a number."
                required
              />
              <span className="field-hint">At least 8 characters, with uppercase, lowercase, and a number.</span>
            </div>
            <div className="field-group">
              <label htmlFor="confirmation">Confirm password</label>
              <input
                id="confirmation"
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </div>
            <div className="field-group declaration-toggle">
              <label htmlFor="isMinor">
                <input
                  id="isMinor"
                  name="isMinor"
                  type="checkbox"
                  checked={isMinor}
                  onChange={(event) => setIsMinor(event.currentTarget.checked)}
                />
                I am registering for a minor
              </label>
            </div>
            {isMinor && (
              <>
                <div className="field-group">
                  <label htmlFor="minorName">Minor Patient name</label>
                  <input
                    id="minorName"
                    name="minorName"
                    type="text"
                    autoComplete="off"
                    maxLength={120}
                    required
                  />
                  <span className="field-hint">
                    Used to identify the minor when a Case is submitted and shared with its reviewing Doctor.
                  </span>
                </div>
                <div className="field-group">
                  <label htmlFor="guardianRelationship">Your relationship to the minor</label>
                  <select id="guardianRelationship" name="guardianRelationship" defaultValue="" required>
                    <option value="" disabled>Select a relationship</option>
                    <option value="parent">Parent</option>
                    <option value="legal_guardian">Legal guardian</option>
                    <option value="other_authorized_guardian">Other authorized guardian</option>
                  </select>
                </div>
                <div className="field-group declaration-toggle">
                  <label htmlFor="authorityAttested">
                    <input id="authorityAttested" name="authorityAttested" type="checkbox" required />
                    I attest that I am authorized to act for this minor
                  </label>
                </div>
              </>
            )}
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Setting password..." : "Create password"}
            </button>
          </form>
          <p className="auth-switch">
            Already set up? <Link href="/login">Sign in</Link>
          </p>
        </div>
      </section>
    </main>
  );
}