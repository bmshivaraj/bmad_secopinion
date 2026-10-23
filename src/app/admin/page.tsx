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

interface PlatformSettings {
  standardCaseFee: string;
  urgentCaseFee: string;
  platformFeePercent: string;
}

interface UnclassifiedCase {
  id: string;
  affectedBodyArea: string;
  condition: string;
  recommendation: string;
  additionalDetails: string;
  urgencyTier: "Standard" | "Urgent" | null;
  doctorId: string | null;
  assignedDoctorName: string | null;
  documents: { id: string; fileName: string; contentType: string; sizeBytes: number }[];
  submittedAt: string | null;
}

interface AssignmentDoctor {
  id: string;
  fullName: string;
}

interface AssignmentCase {
  id: string;
  affectedBodyArea: string;
  condition: string;
  specialtyId: string | null;
  urgencyTier: "Standard" | "Urgent" | null;
  status: string;
  doctorId: string | null;
  assignedDoctorName: string | null;
  availableDoctors: AssignmentDoctor[];
  submittedAt: string | null;
  assignmentLockVersion: number;
}

interface RefundPendingCase {
  id: string;
  affectedBodyArea: string;
  urgencyTier: "Standard" | "Urgent" | null;
  doctorId: string | null;
  submittedAt: string | null;
  chargedAmount: string | null;
  refundDecision: "Approving" | "Rejected" | "Approved" | null;
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
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings | null>(null);
  const [platformSettingsDraft, setPlatformSettingsDraft] = useState<PlatformSettings>({
    standardCaseFee: "",
    urgentCaseFee: "",
    platformFeePercent: "",
  });
  const [unclassifiedCases, setUnclassifiedCases] = useState<UnclassifiedCase[]>([]);
  const [assignmentCases, setAssignmentCases] = useState<AssignmentCase[]>([]);
  const [refundPendingCases, setRefundPendingCases] = useState<RefundPendingCase[]>([]);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSpecialtiesLoading, setIsSpecialtiesLoading] = useState(true);
  const [isPlatformSettingsLoading, setIsPlatformSettingsLoading] = useState(true);
  const [isSavingPlatformSettings, setIsSavingPlatformSettings] = useState(false);
  const [isCasesLoading, setIsCasesLoading] = useState(true);
  const [isAssignmentQueueLoading, setIsAssignmentQueueLoading] = useState(true);
  const [isRefundPendingLoading, setIsRefundPendingLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isAddingSpecialty, setIsAddingSpecialty] = useState(false);
  const [busyDoctorId, setBusyDoctorId] = useState<string | null>(null);
  const [busyCaseId, setBusyCaseId] = useState<string | null>(null);
  const [busyAssignmentCaseId, setBusyAssignmentCaseId] = useState<string | null>(null);
  const [busyRefundCaseId, setBusyRefundCaseId] = useState<string | null>(null);
  const [caseSpecialtySelections, setCaseSpecialtySelections] = useState<Record<string, string>>({});
  const [caseAssignmentSelections, setCaseAssignmentSelections] = useState<Record<string, string>>({});
  const [refreshKey, setRefreshKey] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [specialtyError, setSpecialtyError] = useState("");
  const [specialtyNotice, setSpecialtyNotice] = useState("");
  const [platformSettingsError, setPlatformSettingsError] = useState("");
  const [platformSettingsNotice, setPlatformSettingsNotice] = useState("");
  const [casesError, setCasesError] = useState("");
  const [casesNotice, setCasesNotice] = useState("");
  const [assignmentError, setAssignmentError] = useState("");
  const [assignmentNotice, setAssignmentNotice] = useState("");
  const [refundPendingError, setRefundPendingError] = useState("");
  const [refundDecisionError, setRefundDecisionError] = useState("");
  const [refundDecisionNotice, setRefundDecisionNotice] = useState("");

  useEffect(() => {
    let isCurrent = true;

    async function loadQueue() {
      setIsLoading(true);
      setError("");
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

    async function loadPlatformSettings() {
      setIsPlatformSettingsLoading(true);
      setPlatformSettingsError("");
      try {
        const response = await fetch("/api/admin/platform-settings", { cache: "no-store" });
        const result = await response.json() as ApiResult<PlatformSettings>;
        if (!isCurrent) return;
        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setPlatformSettings(null);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setPlatformSettings(null);
          setPlatformSettingsError(result.error?.message ?? "Unable to load platform settings.");
          return;
        }
        setIsAuthenticated(true);
        setPlatformSettings(result.data);
        setPlatformSettingsDraft(result.data);
      } catch {
        if (isCurrent) {
          setPlatformSettings(null);
          setPlatformSettingsError("Unable to connect. Please try again.");
        }
      } finally {
        if (isCurrent) setIsPlatformSettingsLoading(false);
      }
    }

    async function loadUnclassifiedCases() {
      setIsCasesLoading(true);
      setCasesError("");
      try {
        const response = await fetch("/api/cases/unclassified", { cache: "no-store" });
        const result = await response.json() as ApiResult<UnclassifiedCase[]>;
        if (!isCurrent) return;
        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setUnclassifiedCases([]);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setCasesError(result.error?.message ?? "Unable to load unclassified Cases.");
          return;
        }
        setIsAuthenticated(true);
        setUnclassifiedCases(result.data);
        setCasesError("");
      } catch {
        if (isCurrent) setCasesError("Unable to connect. Please try again.");
      } finally {
        if (isCurrent) setIsCasesLoading(false);
      }
    }

    async function loadAssignmentCases() {
      setIsAssignmentQueueLoading(true);
      setAssignmentError("");
      try {
        const response = await fetch("/api/admin/cases/assignment", { cache: "no-store" });
        const result = await response.json() as ApiResult<AssignmentCase[]>;
        if (!isCurrent) return;
        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setAssignmentCases([]);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setAssignmentError(result.error?.message ?? "Unable to load active Cases.");
          return;
        }
        setIsAuthenticated(true);
        setAssignmentCases(result.data);
        setCaseAssignmentSelections((current) => {
          const availableByCase = new Map(result.data!.map(({ id, availableDoctors }) => [id, new Set(availableDoctors.map(({ id: doctorId }) => doctorId))]));
          return Object.fromEntries(Object.entries(current).filter(([caseId, doctorId]) => availableByCase.get(caseId)?.has(doctorId)));
        });
        setAssignmentError("");
      } catch {
        if (isCurrent) setAssignmentError("Unable to connect. Please try again.");
      } finally {
        if (isCurrent) setIsAssignmentQueueLoading(false);
      }
    }

    async function loadRefundPendingCases() {
      setIsRefundPendingLoading(true);
      setRefundPendingError("");
      try {
        const response = await fetch("/api/admin/cases/refunds", { cache: "no-store" });
        const result = await response.json() as ApiResult<RefundPendingCase[]>;
        if (!isCurrent) return;
        if (response.status === 401 || response.status === 403) {
          setIsAuthenticated(false);
          setRefundPendingCases([]);
          return;
        }
        if (!response.ok || result.error || !result.data) {
          setRefundPendingError(result.error?.message ?? "Unable to load RefundPending Cases.");
          return;
        }
        setIsAuthenticated(true);
        setRefundPendingCases(result.data);
      } catch {
        if (isCurrent) setRefundPendingError("Unable to connect. Please try again.");
      } finally {
        if (isCurrent) setIsRefundPendingLoading(false);
      }
    }

    void loadQueue();
    void loadSpecialties();
    void loadPlatformSettings();
    void loadUnclassifiedCases();
    void loadAssignmentCases();
    void loadRefundPendingCases();
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

  async function handleClassifyCase(caseId: string) {
    const specialtyId = caseSpecialtySelections[caseId] ?? specialties[0]?.id;
    const previousCase = unclassifiedCases.find(({ id }) => id === caseId);
    if (!specialtyId || busyCaseId) return;
    setBusyCaseId(caseId);
    setCasesError("");
    setCasesNotice("");
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/specialty`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ specialtyId }),
      });
      const result = await response.json() as ApiResult<{ id: string; doctorId: string | null }>;
      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        return;
      }
      if (!response.ok || result.error || !result.data) {
        setCasesError(result.error?.message ?? "Unable to classify this Case.");
        if (response.status === 409) setRefreshKey((value) => value + 1);
        return;
      }
      setUnclassifiedCases((current) => current.filter(({ id }) => id !== caseId));
      setCaseSpecialtySelections((current) => {
        const next = { ...current };
        delete next[caseId];
        return next;
      });
      setCasesNotice(previousCase?.doctorId && !result.data.doctorId
        ? "Case classified. Its incompatible Doctor assignment was cleared; the Patient's preference remains saved."
        : "Case classified and added to matching Doctor queues.");
    } catch {
      setCasesError("Unable to connect. Please try again.");
    } finally {
      setBusyCaseId(null);
    }
  }

  async function handleAssignCase(caseRecord: AssignmentCase) {
    const defaultDoctorId = caseRecord.availableDoctors.some(({ id }) => id === caseRecord.doctorId)
      ? caseRecord.doctorId
      : caseRecord.availableDoctors[0]?.id;
    const doctorId = caseAssignmentSelections[caseRecord.id] ?? defaultDoctorId;
    if (!doctorId || busyAssignmentCaseId) return;
    setBusyAssignmentCaseId(caseRecord.id);
    setAssignmentError("");
    setAssignmentNotice("");
    try {
      const response = await fetch(`/api/admin/cases/${encodeURIComponent(caseRecord.id)}/assignment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ doctorId, expectedVersion: caseRecord.assignmentLockVersion }),
      });
      const result = await response.json() as ApiResult<{ doctorId: string; status: string }>;
      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        return;
      }
      if (!response.ok || result.error || !result.data) {
        if (response.status === 409) setRefreshKey((value) => value + 1);
        setAssignmentNotice(response.status === 409
          ? `${result.error?.message ?? "Assignment conflict."} The list is refreshing; verify the current assignee before retrying.`
          : result.error?.message ?? "Unable to assign this Case.");
        return;
      }
      const targetName = caseRecord.availableDoctors.find(({ id }) => id === result.data!.doctorId)?.fullName ?? "the selected Doctor";
      setAssignmentNotice(result.data.doctorId === caseRecord.doctorId && result.data.status === caseRecord.status
        ? `No assignment change. Case ${caseRecord.id} remains assigned to ${targetName}.`
        : result.data.status === "UnderReview" && caseRecord.status === "Submitted"
          ? `Review started for Case ${caseRecord.id} with ${targetName}.`
          : `Case ${caseRecord.id} assigned to ${targetName}.`);
      setRefreshKey((value) => value + 1);
    } catch {
      setAssignmentNotice("Unable to confirm the assignment. Refreshing the active Case list.");
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyAssignmentCaseId(null);
    }
  }

  async function handleRefundDecision(caseRecord: RefundPendingCase, decision: "approve" | "reject") {
    const action = decision === "approve" ? "approve the full captured refund for" : "return to review";
    if (!window.confirm(`Are you sure you want to ${action} Case ${caseRecord.id}?`)) return;
    setBusyRefundCaseId(caseRecord.id);
    setRefundDecisionError("");
    setRefundDecisionNotice("");
    try {
      const response = await fetch(`/api/admin/cases/refunds/${encodeURIComponent(caseRecord.id)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const result = await response.json() as ApiResult<{ decision: string; status: string; refundedAmount?: string | null }>;
      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        return;
      }
      if (!response.ok || result.error || !result.data) {
        setRefundDecisionError(result.error?.message ?? "Unable to save the refund decision.");
        if (response.status === 409) setRefreshKey((value) => value + 1);
        return;
      }
      setRefundDecisionNotice(decision === "approve"
        ? `Refund confirmed for Case ${caseRecord.id}${result.data.refundedAmount ? `: ₹${result.data.refundedAmount}.` : "."}`
        : `Case ${caseRecord.id} returned to Doctor review with a fresh response window.`);
      setRefreshKey((value) => value + 1);
    } catch {
      setRefundDecisionError("Unable to confirm the decision. Refresh the refund list before retrying.");
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyRefundCaseId(null);
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

  async function handleSavePlatformSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isPlatformSettingsLoading || isSavingPlatformSettings) return;
    setPlatformSettingsError("");
    setPlatformSettingsNotice("");
    setIsSavingPlatformSettings(true);
    try {
      const response = await fetch("/api/admin/platform-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(platformSettingsDraft),
      });
      const result = await response.json() as ApiResult<PlatformSettings>;
      if (response.status === 401 || response.status === 403) {
        setIsAuthenticated(false);
        return;
      }
      if (!response.ok || result.error || !result.data) {
        setPlatformSettingsError(result.error?.message ?? "Unable to save platform settings.");
        return;
      }
      setPlatformSettings(result.data);
      setPlatformSettingsDraft(result.data);
      setPlatformSettingsNotice("Platform settings saved.");
    } catch {
      setPlatformSettingsError("Unable to confirm the save. Reload settings before retrying.");
    } finally {
      setIsSavingPlatformSettings(false);
    }
  }

  async function handleLogout() {
    try {
      const response = await fetch("/api/admin/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout request failed.");
      setIsAuthenticated(false);
      setApplications([]);
      setUnclassifiedCases([]);
      setAssignmentCases([]);
      setSpecialties([]);
      setError("");
      setNotice("");
      setSpecialtyError("");
      setSpecialtyNotice("");
      setPlatformSettings(null);
      setPlatformSettingsDraft({ standardCaseFee: "", urgentCaseFee: "", platformFeePercent: "" });
      setPlatformSettingsError("");
      setPlatformSettingsNotice("");
      setCasesError("");
      setCasesNotice("");
      setAssignmentError("");
      setAssignmentNotice("");
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
          {!error && <p className="admin-queue-count" aria-live="polite">{applications.length} pending</p>}
        </div>

        <section className="admin-case-classification-section" aria-labelledby="admin-case-classification-heading">
          <div className="admin-heading-row">
            <div>
              <p className="admin-eyebrow">Case routing</p>
              <h1 id="admin-case-classification-heading">Unclassified Cases</h1>
            </div>
            {!isCasesLoading && <p className="admin-queue-count">{unclassifiedCases.length} awaiting Specialty</p>}
          </div>
          {casesNotice && <p className="admin-notice" role="status">{casesNotice}</p>}
          {casesError && <p className="admin-error" role="alert">{casesError}</p>}
          {isCasesLoading ? (
            <p className="admin-muted" role="status">Loading Cases...</p>
          ) : casesError && unclassifiedCases.length === 0 ? (
            <section className="admin-empty-state"><h2>Case worklist unavailable</h2><p>The unclassified Cases could not be loaded.</p></section>
          ) : unclassifiedCases.length === 0 ? (
            <section className="admin-empty-state"><h2>All Cases classified</h2><p>No submitted Cases are waiting for a Specialty.</p></section>
          ) : (
            <div className="admin-case-list">
              {unclassifiedCases.map((caseRecord) => (
                <article className="admin-case-row" key={caseRecord.id}>
                  <div className="admin-case-description">
                    <h2>{caseRecord.affectedBodyArea}</h2>
                    <p>{caseRecord.condition}</p>
                    <p><strong>Patient-provided recommendation:</strong> {caseRecord.recommendation}</p>
                    {caseRecord.additionalDetails && <p><strong>Additional details:</strong> {caseRecord.additionalDetails}</p>}
                    {caseRecord.documents.length > 0 && (
                      <ul>
                        {caseRecord.documents.map((document) => (
                          <li key={document.id}><a href={`/api/cases/documents/${encodeURIComponent(document.id)}`}>{document.fileName}</a></li>
                        ))}
                      </ul>
                    )}
                    {caseRecord.doctorId && (
                      <p>
                        Currently assigned to {caseRecord.assignedDoctorName ?? "a Doctor"}. If this Specialty does not match, classification clears that assignment while preserving the Patient preference.
                      </p>
                    )}
                    <span>{caseRecord.urgencyTier ?? "Urgency unavailable"} - Submitted {caseRecord.submittedAt ? new Date(caseRecord.submittedAt).toLocaleString() : "time unavailable"}</span>
                  </div>
                  <div className="admin-case-classify-controls">
                    <label className="sr-only" htmlFor={`case-specialty-${caseRecord.id}`}>Specialty for Case</label>
                    <select
                      id={`case-specialty-${caseRecord.id}`}
                      value={caseSpecialtySelections[caseRecord.id] ?? specialties[0]?.id ?? ""}
                      onChange={(event) => setCaseSpecialtySelections((current) => ({ ...current, [caseRecord.id]: event.target.value }))}
                      disabled={isSpecialtiesLoading || specialties.length === 0 || busyCaseId !== null}
                    >
                      {specialties.length === 0 ? <option value="">No active specialties</option> : specialties.map((specialty) => (
                        <option value={specialty.id} key={specialty.id}>{specialty.name}</option>
                      ))}
                    </select>
                    <button
                      className="admin-decision admin-decision-approve"
                      type="button"
                      onClick={() => void handleClassifyCase(caseRecord.id)}
                      disabled={isSpecialtiesLoading || specialties.length === 0 || busyCaseId !== null}
                    >
                      {busyCaseId === caseRecord.id ? "Saving..." : "Classify"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="admin-case-classification-section" aria-labelledby="admin-case-assignment-heading">
          <div className="admin-heading-row">
            <div>
              <p className="admin-eyebrow">Case review</p>
              <h1 id="admin-case-assignment-heading">Active Case assignments</h1>
            </div>
            <div className="admin-queue-actions">
              {!isAssignmentQueueLoading && <p className="admin-queue-count">{assignmentCases.length} active</p>}
              <button className="admin-signout" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={isAssignmentQueueLoading || busyAssignmentCaseId !== null}>Refresh assignments</button>
            </div>
          </div>
          {assignmentNotice && <p className="admin-notice" role="status">{assignmentNotice}</p>}
          {assignmentError && <p className="admin-error" role="alert">{assignmentError}</p>}
          {isAssignmentQueueLoading ? (
            <p className="admin-muted" role="status">Loading active Cases...</p>
          ) : assignmentError && assignmentCases.length === 0 ? (
            <section className="admin-empty-state"><h2>Assignment queue unavailable</h2><p>Active Cases could not be loaded.</p></section>
          ) : assignmentCases.length === 0 ? (
            <section className="admin-empty-state"><h2>No active Cases</h2><p>There are no classified Cases awaiting or undergoing review.</p></section>
          ) : (
            <div className="admin-case-list">
              {assignmentCases.map((caseRecord) => {
                const defaultDoctorId = caseRecord.availableDoctors.some(({ id }) => id === caseRecord.doctorId)
                  ? caseRecord.doctorId
                  : caseRecord.availableDoctors[0]?.id ?? "";
                const selectedDoctorId = caseAssignmentSelections[caseRecord.id] ?? defaultDoctorId;
                const currentDoctorSelected = selectedDoctorId !== "" && selectedDoctorId === caseRecord.doctorId;
                const actionLabel = currentDoctorSelected
                  ? caseRecord.status === "Submitted" ? "Confirm review" : "Keep current"
                  : caseRecord.doctorId ? "Reassign" : "Assign";
                return (
                  <article className="admin-case-row" key={caseRecord.id}>
                    <div className="admin-case-description">
                      <h2>{caseRecord.affectedBodyArea}</h2>
                      <p>Case ID: {caseRecord.id}</p>
                      <p>{caseRecord.condition}</p>
                      <p><strong>Specialty:</strong> {specialties.find(({ id }) => id === caseRecord.specialtyId)?.name ?? caseRecord.specialtyId ?? "Unavailable"}</p>
                      <p><strong>Status:</strong> {caseRecord.status.replace(/([a-z])([A-Z])/g, "$1 $2")} · <strong>Urgency:</strong> {caseRecord.urgencyTier ?? "Unavailable"}</p>
                      <p><strong>Current Doctor:</strong> {caseRecord.assignedDoctorName ?? "Unassigned"}</p>
                      <span>Submitted {caseRecord.submittedAt ? new Date(caseRecord.submittedAt).toLocaleString() : "time unavailable"}</span>
                    </div>
                    <div className="admin-case-classify-controls">
                      <label className="sr-only" htmlFor={`case-doctor-${caseRecord.id}`}>Doctor for Case {caseRecord.id}</label>
                      <select
                        id={`case-doctor-${caseRecord.id}`}
                        value={selectedDoctorId}
                        onChange={(event) => setCaseAssignmentSelections((current) => ({ ...current, [caseRecord.id]: event.target.value }))}
                        disabled={caseRecord.availableDoctors.length === 0 || busyAssignmentCaseId !== null}
                      >
                        {caseRecord.availableDoctors.length === 0
                          ? <option value="">No verified Doctors in Specialty</option>
                          : caseRecord.availableDoctors.map((doctor) => <option value={doctor.id} key={doctor.id}>{doctor.fullName}</option>)}
                      </select>
                      <button
                        className="admin-decision admin-decision-approve"
                        type="button"
                        onClick={() => void handleAssignCase(caseRecord)}
                        disabled={caseRecord.availableDoctors.length === 0 || busyAssignmentCaseId !== null}
                      >
                        {busyAssignmentCaseId === caseRecord.id ? "Saving..." : actionLabel}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="admin-case-classification-section" aria-labelledby="admin-refund-pending-heading">
          <div className="admin-heading-row">
            <div>
              <p className="admin-eyebrow">Refund review</p>
              <h1 id="admin-refund-pending-heading">RefundPending Cases</h1>
            </div>
            <div className="admin-queue-actions">
              {!isRefundPendingLoading && <p className="admin-queue-count">{refundPendingCases.length} pending decision</p>}
              <button className="admin-signout" type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={isRefundPendingLoading}>Refresh refund list</button>
            </div>
          </div>
          {refundPendingError && <p className="admin-error" role="alert">{refundPendingError}</p>}
          {refundDecisionNotice && <p className="admin-notice" role="status">{refundDecisionNotice}</p>}
          {refundDecisionError && <p className="admin-error" role="alert">{refundDecisionError}</p>}
          {isRefundPendingLoading ? (
            <p className="admin-muted" role="status">Loading RefundPending Cases...</p>
          ) : refundPendingError && refundPendingCases.length === 0 ? (
            <section className="admin-empty-state"><h2>Refund worklist unavailable</h2><p>Pending refund decisions could not be loaded.</p></section>
          ) : refundPendingCases.length === 0 ? (
            <section className="admin-empty-state"><h2>No refund decisions pending</h2><p>Cases that breach the Response SLA will appear here.</p></section>
          ) : (
            <div className="admin-case-list">
              {refundPendingCases.map((caseRecord) => (
                <article className="admin-case-row" key={caseRecord.id}>
                  <div className="admin-case-description">
                    <h2>{caseRecord.affectedBodyArea}</h2>
                    <p>Case ID: {caseRecord.id}</p>
                    <p><strong>Captured amount:</strong> {caseRecord.chargedAmount ? `₹${caseRecord.chargedAmount}` : "Unavailable"}</p>
                    <p><strong>Urgency:</strong> {caseRecord.urgencyTier ?? "Unavailable"}</p>
                    <p><strong>Doctor:</strong> {caseRecord.doctorId ?? "Unassigned"}</p>
                    <span>Submitted {caseRecord.submittedAt ? new Date(caseRecord.submittedAt).toLocaleString() : "time unavailable"}</span>
                  </div>
                  <div className="admin-decision-actions">
                    <strong className="admin-status">{caseRecord.refundDecision === "Approving" ? "Approval in progress" : "Awaiting decision"}</strong>
                    <button
                      className="admin-decision admin-decision-approve"
                      type="button"
                      disabled={busyRefundCaseId !== null}
                      onClick={() => void handleRefundDecision(caseRecord, "approve")}
                    >
                      {busyRefundCaseId === caseRecord.id ? "Processing..." : caseRecord.refundDecision === "Approving" ? "Retry approval" : "Approve refund"}
                    </button>
                    <button
                      className="admin-decision admin-decision-reject"
                      type="button"
                      disabled={busyRefundCaseId !== null || caseRecord.refundDecision !== null}
                      onClick={() => void handleRefundDecision(caseRecord, "reject")}
                    >
                      Reject and resume
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {notice && <p className="admin-notice" role="status">{notice}</p>}
        {error && <p className="admin-error" role="alert">{error}</p>}
        {error && isAuthenticated && !isLoading && (
          <button className="admin-signout" type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            Retry queue
          </button>
        )}
        {isLoading ? (
          <p className="admin-muted" role="status">Loading applications...</p>
        ) : error && applications.length === 0 ? (
          <section className="admin-empty-state">
            <h2>Queue unavailable</h2>
            <p>The verification queue could not be loaded.</p>
          </section>
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

        <section className="admin-settings-section" aria-labelledby="admin-settings-heading">
          <div className="admin-heading-row">
            <div>
              <p className="admin-eyebrow">Pricing</p>
              <h1 id="admin-settings-heading">Case fees</h1>
            </div>
          </div>
          {platformSettingsNotice && <p className="admin-notice" role="status">{platformSettingsNotice}</p>}
          {platformSettingsError && <p className="admin-error" role="alert">{platformSettingsError}</p>}
          {isPlatformSettingsLoading ? (
            <p className="admin-muted" role="status">Loading platform settings...</p>
          ) : platformSettingsError && !platformSettings ? (
            <div className="admin-empty-state">
              <h2>Pricing settings unavailable</h2>
              <p>The current fee values could not be loaded.</p>
              <button className="admin-signout" type="button" onClick={() => setRefreshKey((value) => value + 1)}>Retry loading settings</button>
            </div>
          ) : platformSettings ? (
            <form className="admin-settings-form" onSubmit={handleSavePlatformSettings}>
              <div className="admin-settings-grid">
                <div className="field-group">
                  <label htmlFor="standard-case-fee">Standard Case fee (INR)</label>
                  <input
                    id="standard-case-fee"
                    type="number"
                    min="0.01"
                    max="99999999.99"
                    step="0.01"
                    inputMode="decimal"
                    required
                    value={platformSettingsDraft.standardCaseFee}
                    onChange={(event) => setPlatformSettingsDraft((current) => ({ ...current, standardCaseFee: event.target.value }))}
                    disabled={isSavingPlatformSettings}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="urgent-case-fee">Urgent Case fee (INR)</label>
                  <input
                    id="urgent-case-fee"
                    type="number"
                    min="0.01"
                    max="99999999.99"
                    step="0.01"
                    inputMode="decimal"
                    required
                    value={platformSettingsDraft.urgentCaseFee}
                    onChange={(event) => setPlatformSettingsDraft((current) => ({ ...current, urgentCaseFee: event.target.value }))}
                    disabled={isSavingPlatformSettings}
                  />
                </div>
                <div className="field-group">
                  <label htmlFor="platform-fee-percent">Platform Fee (%)</label>
                  <input
                    id="platform-fee-percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    inputMode="decimal"
                    required
                    value={platformSettingsDraft.platformFeePercent}
                    onChange={(event) => setPlatformSettingsDraft((current) => ({ ...current, platformFeePercent: event.target.value }))}
                    disabled={isSavingPlatformSettings}
                  />
                </div>
              </div>
              <button className="admin-decision admin-decision-approve" type="submit" disabled={isSavingPlatformSettings || isPlatformSettingsLoading}>
                {isSavingPlatformSettings ? "Saving..." : "Save pricing"}
              </button>
            </form>
          ) : null}
        </section>
      </section>
    </main>
  );
}