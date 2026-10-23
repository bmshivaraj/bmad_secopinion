"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface ApiResult<T> {
	data: T | null;
	error: { message: string } | null;
}

interface CaseDocument {
	id: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
}

interface CaseDocumentRequest {
	id: string;
	note: string;
	createdAt: string;
	fulfilledAt: string | null;
	closedAt: string | null;
}

interface CaseOpinion {
	text: string;
	createdAt: string;
}

interface PatientCase {
	id: string;
	affectedBodyArea: string;
	condition: string;
	status: string;
	urgencyTier: "Standard" | "Urgent" | null;
	submittedAt: string | null;
	updatedAt: string;
	refundConfirmedAt: string | null;
	refundedAmount: string | null;
	documents: CaseDocument[];
	documentRequests: CaseDocumentRequest[];
	opinion: CaseOpinion | null;
}

function displayStatus(status: string): string {
	return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function displayDate(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "Submission time unavailable";
}

export default function PatientCasesPage() {
	const [cases, setCases] = useState<PatientCase[]>([]);
	const [refreshKey, setRefreshKey] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [isUnauthorized, setIsUnauthorized] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [actionError, setActionError] = useState("");
	const [notice, setNotice] = useState("");
	const [busyCaseId, setBusyCaseId] = useState<string | null>(null);

	useEffect(() => {
		let isCurrent = true;
		setIsLoading(true);
		setLoadError("");
		fetch("/api/cases", { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ApiResult<PatientCase[]> }))
			.then(({ response, result }) => {
				if (!isCurrent) return;
				setIsUnauthorized(response.status === 401);
				if (!response.ok || result.error || !result.data) {
					setCases([]);
					if (response.status !== 401) setLoadError(result.error?.message ?? "Unable to load your Cases.");
					return;
				}
				setCases(result.data);
			})
			.catch(() => {
				if (isCurrent) setLoadError("Unable to connect. Please try again.");
			})
			.finally(() => {
				if (isCurrent) setIsLoading(false);
			});
		return () => {
			isCurrent = false;
		};
	}, [refreshKey]);

	async function uploadResponse(caseId: string, event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const form = event.currentTarget;
		const formData = new FormData(form);
		if (!formData.getAll("documents").some((value) => value instanceof File && value.size > 0)) {
			setActionError("Choose at least one Document to upload.");
			return;
		}
		setBusyCaseId(caseId);
		setActionError("");
		setNotice("");
		try {
			const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/documents`, {
				method: "POST",
				body: formData,
			});
			const result = await response.json() as ApiResult<CaseDocument[]>;
			if (!response.ok || result.error || !result.data) {
				if (response.status === 401) {
					setIsUnauthorized(true);
					setCases([]);
					setActionError("Your Patient session expired. Sign in to continue.");
					return;
				}
				setActionError(result.error?.message ?? "Unable to upload Documents.");
				return;
			}
			form.reset();
			setNotice("Documents uploaded. Your Case has returned to Doctor review.");
			setRefreshKey((current) => current + 1);
		} catch {
			setActionError("Unable to confirm whether the upload completed. Refresh your Cases before retrying.");
			setRefreshKey((current) => current + 1);
		} finally {
			setBusyCaseId(null);
		}
	}

	return (
		<main className="case-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/">
					<span className="case-brand-mark" aria-hidden="true">S</span>
					SecOpinion
				</Link>
				<nav className="patient-case-nav" aria-label="Patient account">
					<Link className="case-account-link" href="/cases/new">New Case</Link>
					<Link className="case-account-link" href="/login?returnTo=%2Fcases">Patient account</Link>
				</nav>
			</header>

			<div className="patient-cases-content">
				<div className="patient-cases-heading-row">
					<div className="case-heading">
						<p className="case-kicker">PATIENT WORKSPACE <span>/</span> CASES</p>
						<h1>Your Cases</h1>
						<p className="case-intro">Submitted cases and requests for additional Documents.</p>
					</div>
					<button className="case-button case-button-secondary" type="button" onClick={() => setRefreshKey((current) => current + 1)} disabled={isLoading || isUnauthorized}>
						Refresh Cases
					</button>
				</div>

				{notice && <p className="case-message case-message-success" role="status">{notice}</p>}
				{actionError && <p className="case-message case-message-error" role="alert">{actionError}</p>}

				{isLoading ? (
					<p className="case-loading" role="status">Loading your Cases...</p>
				) : isUnauthorized ? (
					<section className="patient-case-empty"><h2>Sign in required</h2><p>Your Patient session is missing or expired.</p><Link href="/login?returnTo=%2Fcases">Patient sign in</Link></section>
				) : loadError ? (
					<section className="patient-case-empty"><h2>Cases unavailable</h2><p role="alert">{loadError}</p><button className="case-button case-button-secondary" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Retry</button></section>
				) : cases.length === 0 ? (
					<section className="patient-case-empty"><h2>No submitted Cases</h2><p>Your submitted Cases will appear here.</p><Link className="case-button case-button-primary" href="/cases/new">Start a Case</Link></section>
				) : (
					<div className="patient-case-list">
						{cases.map((caseRecord) => (
							<article className="patient-case-item" key={caseRecord.id}>
								<header className="patient-case-item-header">
									<div>
										<p className="patient-case-id">Case {caseRecord.id}</p>
										<h2>{caseRecord.affectedBodyArea}</h2>
									</div>
									<div className="patient-case-status">
										<strong>{displayStatus(caseRecord.status)}</strong>
										<span>{caseRecord.urgencyTier ?? "Standard"}</span>
									</div>
								</header>
								<p className="patient-case-condition">{caseRecord.condition}</p>
								<p className="patient-case-submitted">Submitted {displayDate(caseRecord.submittedAt)}</p>
								{caseRecord.refundConfirmedAt && (
									<p className="case-message case-message-success" role="status">
										Refund confirmed{caseRecord.refundedAmount ? `: ₹${caseRecord.refundedAmount}` : ""} to your original payment on {displayDate(caseRecord.refundConfirmedAt)}.
									</p>
								)}

								{caseRecord.documentRequests.length > 0 && (
									<section className="patient-case-requests" aria-label="Document request history">
										<h3>Document requests</h3>
										<ol>{caseRecord.documentRequests.map((documentRequest) => (
											<li key={documentRequest.id}>
												<p>{documentRequest.note}</p>
												<time dateTime={documentRequest.createdAt}>{displayDate(documentRequest.createdAt)}</time>
												<strong>{documentRequest.closedAt ? "Closed by Opinion" : documentRequest.fulfilledAt ? "Documents received" : "Response needed"}</strong>
												{documentRequest.fulfilledAt && <span className="patient-case-fulfilled">Received {displayDate(documentRequest.fulfilledAt)}</span>}
										</li>
										))}</ol>
									</section>
								)}

								{caseRecord.documents.length > 0 && (
									<section className="patient-case-documents" aria-label="Case Documents">
										<h3>Documents</h3>
										<ul>{caseRecord.documents.map((document) => (
											<li key={document.id}><a href={`/api/cases/documents/${encodeURIComponent(document.id)}`}>{document.fileName}</a></li>
										))}</ul>
									</section>
								)}

								{caseRecord.opinion && (
									<section className="patient-case-opinion" aria-label="Final Opinion">
										<h3>Final Opinion</h3>
										<p>{caseRecord.opinion.text}</p>
										<time dateTime={caseRecord.opinion.createdAt}>{displayDate(caseRecord.opinion.createdAt)}</time>
									</section>
								)}

								{caseRecord.status === "MoreInfoRequested" && (
									<form className="patient-case-upload" onSubmit={(event) => void uploadResponse(caseRecord.id, event)}>
										<label htmlFor={`documents-${caseRecord.id}`}>Add Documents</label>
										<input id={`documents-${caseRecord.id}`} name="documents" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" multiple required />
										<button className="case-button case-button-primary" type="submit" disabled={busyCaseId !== null}>
											{busyCaseId === caseRecord.id ? "Uploading..." : "Upload Documents"}
										</button>
									</form>
								)}
							</article>
						))}
					</div>
				)}
			</div>
		</main>
	);
}
