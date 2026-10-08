"use client";

import { useEffect, useState, type FormEvent } from "react";

interface Credential {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  href: string;
}

interface Application {
  doctorId: string;
  fullName: string;
  username: string;
  verificationStatus: "Pending" | "Verified" | "Rejected";
  specialties: { id: string; name: string }[];
  credentials: Credential[];
}

interface Specialty {
  id: string;
  name: string;
}

interface ApiResult<T> {
  data: T | null;
  error: { message: string } | null;
}

function formatFileSize(sizeBytes: number): string {
  return sizeBytes < 1024 * 1024
    ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
    : `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AdminPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSpecialtiesLoading, setIsSpecialtiesLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingSpecialty, setIsAddingSpecialty] = useState(false);
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [specialtyError, setSpecialtyError] = useState("");
  const [specialtyNotice, setSpecialtyNotice] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function loadQueue() {
      setIsLoading(true);
      try {
        const response = await fetch("/api/admin/verification-queue", { cache: "no-store" });
        const result = await response.json() as ApiResult<Application[]>;
        if (!isCurrent) return;
        if (response.status === 401) {
          setIsAuthenticated(false);
          setApplications([]);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setError(result.error?.message ?? "Unable to load the verification queue.");
          return;
        }
        setIsAuthenticated(true);
        setApplications(result.data);
        setError("");
      } catch {
        if (isCurrent) setError("Unable to connect. Please try again.");
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }

    async function loadSpecialties() {
      setIsSpecialtiesLoading(true);
      try {
        const response = await fetch("/api/admin/specialties", { cache: "no-store" });
        const result = await response.json() as ApiResult<Specialty[]>;
        if (!isCurrent) return;
        if (response.status === 401) {
          setIsAuthenticated(false);
          setSpecialties([]);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setSpecialtyError(result.error?.message ?? "Unable to load the Specialty catalog.");
          return;
        }
        setIsAuthenticated(true);
        setSpecialties(result.data);
        setSpecialtyError("");
      } catch {
        if (isCurrent) setSpecialtyError("Unable to connect. Please try again.");
      } finally {
        if (isCurrent) setIsSpecialtiesLoading(false);
      }
    }

    void loadQueue();
    void loadSpecialties();
    return () => {
      isCurrent = false;
    };
  }, [refreshKey]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    const formData = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: formData.get("username"), password: formData.get("password") }),
      });
      const result = await response.json() as ApiResult<{ adminId: string }>;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to sign in. Please try again.");
        return;
      }
      setIsAuthenticated(true);
      setIsLoading(true);
      setRefreshKey((value) => value + 1);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDecision(application: Application, verificationStatus: "Verified" | "Rejected") {
    if (!window.confirm(`Mark ${application.fullName} as ${verificationStatus}? This decision is final.`)) return;
    setBusyDoctorId(application.doctorId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/doctors/${encodeURIComponent(application.doctorId)}/verification`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verificationStatus }),
      });
      const result = await response.json() as ApiResult<Application>;
      if (!response.ok || result.error || !result.data) {
        setError(result.error?.message ?? "Unable to save the decision.");
        if (response.status === 409) setRefreshKey((value) => value + 1);
        return;
      }
      setApplications((current) => current.filter(({ doctorId }) => doctorId !== application.doctorId));
      setNotice(`${application.fullName} marked ${verificationStatus}.`);
    } catch {
      setError("Unable to connect. Please try again.");
    } finally {
      setBusyDoctorId(null);
    }
  }

  async function handleAddSpecialty(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSpecialtiesLoading || isAddingSpecialty) return;
    setSpecialtyError("");
    setSpecialtyNotice("");
    setIsAddingSpecialty(true);
    const form = event.currentTarget;
    const name = new FormData(form).get("specialtyName");
    try {
      const response = await fetch("/api/admin/specialties", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const result = await response.json() as ApiResult<Specialty>;
      if (!response.ok || result.error || !result.data) {
        setSpecialtyError(result.error?.message ?? "Unable to add the Specialty.");
        return;
      }
      setSpecialties((current) => [...current, result.data!].sort((left, right) => left.name.localeCompare(right.name)));
      form.reset();
      setSpecialtyNotice(`${result.data.name} added to the catalog.`);
    } catch {
      setSpecialtyError("Unable to connect. Please try again.");
    } finally {
      setIsAddingSpecialty(false);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout request failed.");
      setIsAuthenticated(false);
      setApplications([]);
      setSpecialties([]);
      setError("");
      setNotice("");
      setSpecialtyError("");
      setSpecialtyNotice("");
      setRefreshKey((value) => value + 1);
    } catch {
      setError("Unable to sign out. Please try again.");
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="admin-login-page">
        <a className="admin-brand" href="/">SecOpinion <span>Administration</span></a>
        <section className="admin-login-panel">
          <p className="admin-eyebrow">Doctor onboarding</p>
          <h1>Verification review</h1>
          <p className="admin-muted">Sign in with the operator-provisioned Admin account.</p>
          <form className="auth-form" onSubmit={handleLogin}>
            <div className="field-group">
              <label htmlFor="admin-username">Username</label>
              <input id="admin-username" name="username" type="text" autoComplete="username" required />
            </div>
            <div className="field-group">
              <label htmlFor="admin-password">Password</label>
              <input id="admin-password" name="password" type="password" autoComplete="current-password" required />
            </div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a className="admin-brand" href="/">SecOpinion <span>Admin</span></a>
        <button className="admin-signout" type="button" onClick={handleLogout}>Sign out</button>
      </header>
      <section className="admin-content">
        <div className="admin-heading-row">
          <div>
            <p className="admin-eyebrow">Doctor onboarding</p>
            <h1>Verification queue</h1>
          </div>
          <p className="admin-queue-count" aria-live="polite">{applications.length} pending</p>
        </div>

        {notice && <p className="admin-notice" role="status">{notice}</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {isLoading ? (
          <p className="admin-muted" role="status">Loading applications...</p>
        ) : applications.length === 0 ? (
          <section className="admin-empty-state">
            <h2>Queue clear</h2>
            <p>No Doctor applications are waiting for review.</p>
          </section>
        ) : (
          <div className="admin-application-list">
            {applications.map((application) => (
              <article className="admin-application" key={application.doctorId}>
                <div className="admin-application-heading">
                  <div>
                    <h2>{application.fullName}</h2>
                    <p className="admin-muted">@{application.username}</p>
                  </div>
                  <span className="admin-status">Pending</span>
                </div>
                <div className="admin-review-section">
                  <h3>Specialties</h3>
                  <p>{application.specialties.map(({ name }) => name).join(", ")}</p>
                </div>
                <div className="admin-review-section">
                  <h3>Credentials</h3>
                  <ul className="admin-credential-list">
                    {application.credentials.map((credential) => (
                      <li key={credential.id}>
                        <a href={credential.href} target="_blank" rel="noopener noreferrer">{credential.fileName}</a>
                        <span>{credential.contentType}, {formatFileSize(credential.sizeBytes)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="admin-decision-actions">
                  <button
                    className="admin-decision admin-decision-approve"
                    type="button"
                    disabled={busyDoctorId !== null}
                    onClick={() => void handleDecision(application, "Verified")}
                  >
                    {busyDoctorId === application.doctorId ? "Saving..." : "Verify"}
                  </button>
                  <button
                    className="admin-decision admin-decision-reject"
                    type="button"
                    disabled={busyDoctorId !== null}
                    onClick={() => void handleDecision(application, "Rejected")}
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}

        <section className="admin-specialty-section" aria-labelledby="admin-specialty-heading">
          <div className="admin-heading-row">
            <div>
              <p className="admin-eyebrow">Reference data</p>
              <h1 id="admin-specialty-heading">Specialty catalog</h1>
            </div>
            {!isSpecialtiesLoading && <p className="admin-queue-count">{specialties.length} active</p>}
          </div>
          {specialtyNotice && <p className="admin-notice" role="status">{specialtyNotice}</p>}
          {specialtyError && <p className="admin-error" role="alert">{specialtyError}</p>}
          {specialtyError && !isSpecialtiesLoading && (
            <button className="admin-signout" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
              Retry loading catalog
            </button>
          )}
          <form className="admin-specialty-form" onSubmit={handleAddSpecialty}>
            <div className="field-group">
              <label htmlFor="specialty-name">New Specialty</label>
              <input
                id="specialty-name"
                name="specialtyName"
                type="text"
                maxLength={120}
                required
                autoComplete="off"
                placeholder="e.g. Rheumatology"
                disabled={isAddingSpecialty || isSpecialtiesLoading}
              />
            </div>
            <button className="admin-decision admin-decision-approve" type="submit" disabled={isAddingSpecialty || isSpecialtiesLoading}>
              {isAddingSpecialty ? "Adding..." : "Add Specialty"}
            </button>
          </form>
          {isSpecialtiesLoading ? (
            <p className="admin-muted" role="status">Loading specialties...</p>
          ) : specialtyError ? null : specialties.length === 0 ? (
            <div className="admin-empty-state">
              <h2>No active specialties</h2>
              <p>Add the first Specialty to make it available for Doctor registration.</p>
            </div>
          ) : (
            <ul className="admin-specialty-list">
              {specialties.map((specialty) => <li key={specialty.id}>{specialty.name}</li>)}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}