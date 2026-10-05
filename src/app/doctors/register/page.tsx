"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface Specialty {
  id: string;
  name: string;
}

interface ApiResult<T> {
  data: T | null;
  error: { message: string } | null;
}

interface ApplicationResult {
  verificationStatus: string;
}

export default function DoctorRegistrationPage() {
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [otpId, setOtpId] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [submittedStatus, setSubmittedStatus] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let isActive = true;
    fetch("/api/doctors/specialties")
      .then(async (response) => await response.json() as ApiResult<Specialty[]>)
      .then((result) => {
        if (!isActive) return;
        if (result.error) setError(result.error.message);
        else setSpecialties(result.data ?? []);
      })
      .catch(() => {
        if (isActive) setError("Unable to load specialties. Please refresh and try again.");
      });
    return () => {
      isActive = false;
    };
  }, []);

  async function handleStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const submittedMobile = String(formData.get("mobileNumber") ?? "");
    try {
      const response = await fetch("/api/doctors/register/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobileNumber: submittedMobile }),
      });
      const result = await response.json() as ApiResult<{ otpId: string }>;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to send a code. Please try again.");
        return;
      }
      setMobileNumber(submittedMobile);
      setOtpId(result.data.otpId);
      setNotice("A verification code has been sent.");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/doctors/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mobileNumber,
          otpId,
          code: String(formData.get("code") ?? ""),
        }),
      });
      const result = await response.json() as ApiResult<{ verified: boolean }>;
      if (!response.ok || result.error || !result.data?.verified) {
        setError(result.error?.message ?? "Unable to verify this code.");
        return;
      }
      setIsVerified(true);
      setNotice("Mobile number verified. Complete your professional application.");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleResendCode() {
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch("/api/doctors/register/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mobileNumber }),
      });
      const result = await response.json() as ApiResult<{ otpId: string }>;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to resend a code. Please try again.");
        return;
      }
      setOtpId(result.data.otpId);
      setNotice("A new verification code has been sent.");
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleChangeMobile() {
    setOtpId("");
    setMobileNumber("");
    setError("");
    setNotice("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    const specialtyIds = formData.getAll("specialtyIds");
    const credentials = formData.getAll("credentials").filter((value): value is File => value instanceof File && value.size > 0);
    if (specialtyIds.length < 1) {
      setError("Select at least one specialty.");
      setIsSubmitting(false);
      return;
    }
    if (credentials.length < 1 || credentials.length > 5) {
      setError("Upload between 1 and 5 credential files.");
      setIsSubmitting(false);
      return;
    }
    if (credentials.some((file) => file.size > 10 * 1024 * 1024)) {
      setError("Each credential must be no larger than 10 MiB.");
      setIsSubmitting(false);
      return;
    }
    if (credentials.some((file) => !["image/jpeg", "image/png", "application/pdf"].includes(file.type))) {
      setError("Credentials must be JPEG, PNG, or PDF files.");
      setIsSubmitting(false);
      return;
    }
    try {
      const response = await fetch("/api/doctors/register/submit", { method: "POST", body: formData });
      const result = await response.json() as ApiResult<ApplicationResult>;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to submit your application.");
        return;
      }
      setSubmittedStatus(result.data.verificationStatus);
      setNotice("");
      setOtpId("");
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
          <p className="story-kicker">For medical professionals</p>
          <h1>Bring your expertise to another perspective.</h1>
          <p>Submit your credentials for a manual review by the SecOpinion team.</p>
        </div>
        <div className="story-foot">Professional review starts with verified credentials</div>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap doctor-form-wrap">
          <Link className="auth-brand auth-mobile-brand" href="/">
            <span className="brand-mark" aria-hidden="true">S</span>
            SecOpinion
          </Link>
          <p className="auth-eyebrow">Doctor account</p>
          <h2>Professional registration</h2>
          <p className="auth-intro">Verify your mobile, then submit your credentials and specialties.</p>
          {notice && <p className="auth-success" role="status">{notice}</p>}

          {!isVerified && !submittedStatus && (
            <>
              <p className="doctor-step">{otpId ? "Step 2 of 2 · Verify your mobile" : "Step 1 of 2 · Verify your mobile"}</p>
              {!otpId ? (
                <form className="auth-form" onSubmit={handleStart}>
                  <div className="field-group">
                    <label htmlFor="mobileNumber">Mobile number</label>
                    <input id="mobileNumber" name="mobileNumber" type="tel" autoComplete="tel" pattern="\+?[0-9]{10,15}" required />
                  </div>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-submit" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Sending code..." : "Send verification code"}
                  </button>
                </form>
              ) : (
                <form className="auth-form" onSubmit={handleVerify}>
                  <div className="field-group">
                    <label htmlFor="code">Verification code for {mobileNumber}</label>
                    <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{4,8}" required />
                  </div>
                  {error && <p className="auth-error" role="alert">{error}</p>}
                  <button className="auth-submit" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Verifying..." : "Verify mobile"}
                  </button>
                  <div className="doctor-verification-actions">
                    <button className="auth-secondary" type="button" onClick={handleResendCode} disabled={isSubmitting}>
                      Resend code
                    </button>
                    <button className="auth-secondary" type="button" onClick={handleChangeMobile} disabled={isSubmitting}>
                      Change mobile number
                    </button>
                  </div>
                </form>
              )}
            </>
          )}

          {isVerified && (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="field-group">
                <label htmlFor="fullName">Full professional name</label>
                <input id="fullName" name="fullName" type="text" autoComplete="name" maxLength={120} required />
              </div>
              <div className="field-group">
                <label htmlFor="username">Username</label>
                <input id="username" name="username" type="text" autoComplete="username" minLength={3} maxLength={30} pattern="[A-Za-z0-9_]{3,30}" required />
                <span className="field-hint">3-30 letters, numbers, or underscores.</span>
              </div>
              <div className="field-group">
                <label htmlFor="password">Password</label>
                <input id="password" name="password" type="password" autoComplete="new-password" minLength={8} maxLength={1024} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9]).{8,}" required />
                <span className="field-hint">At least 8 characters, with uppercase, lowercase, and a number.</span>
              </div>
              <div className="field-group">
                <label htmlFor="upiId">UPI ID <span className="field-hint">(optional)</span></label>
                <input id="upiId" name="upiId" type="text" autoComplete="off" maxLength={255} pattern={"[A-Za-z0-9]+(?:[._\\x2D][A-Za-z0-9]+)*@[A-Za-z0-9]+(?:[.\\x2D][A-Za-z0-9]+)*"} title="Use local-part@handle format, such as name@bank" />
                <span className="field-hint">For payouts, enter an ID in local-part@handle format. You can add it later.</span>
              </div>
              <fieldset className="doctor-specialties">
                <legend>Specialties</legend>
                {specialties.map((specialty) => (
                  <label className="doctor-specialty-option" key={specialty.id}>
                    <input type="checkbox" name="specialtyIds" value={specialty.id} />
                    <span>{specialty.name}</span>
                  </label>
                ))}
                {specialties.length === 0 && <span className="field-hint">No active specialties are available.</span>}
              </fieldset>
              <div className="field-group doctor-upload">
                <label htmlFor="credentials">Credential documents</label>
                <input id="credentials" name="credentials" type="file" accept="image/jpeg,image/png,application/pdf" multiple required />
                <span className="field-hint">Upload 1-5 JPEG, PNG, or PDF files, each up to 10 MiB.</span>
              </div>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <button className="auth-submit" type="submit" disabled={isSubmitting || specialties.length === 0}>
                {isSubmitting ? "Submitting..." : "Submit for verification"}
              </button>
            </form>
          )}

          {submittedStatus && (
            <div className="auth-success" role="status">
              Application submitted. Verification status: {submittedStatus}.
              <p><Link href="/doctors/login">Continue to Doctor sign in</Link></p>
            </div>
          )}

          {!submittedStatus && (
            <p className="auth-switch">Already registered? <Link href="/doctors/login">Doctor sign in</Link></p>
          )}
        </div>
      </section>
    </main>
  );
}