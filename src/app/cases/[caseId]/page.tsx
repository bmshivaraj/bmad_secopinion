"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { ApiResult, PatientCase } from "../case-types";

function displayStatus(status: string): string {
	return status.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function displayDate(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "Not available";
}

export default function PatientCaseDetailPage() {
	const { caseId } = useParams<{ caseId: string }>();
	const [caseRecord, setCaseRecord] = useState<PatientCase | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState("");

	useEffect(() => {
		let isCurrent = true;
		setIsLoading(true);
		setLoadError("");
		fetch(`/api/cases/${encodeURIComponent(caseId)}`, { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ApiResult<PatientCase> }))
			.then(({ response, result }) => {
				if (!isCurrent) return;
				if (response.status === 401) {
					window.location.assign("/login?returnTo=%2Fcases");
					return;
				}
				if (!response.ok || result.error || !result.data) {
					setLoadError(response.status === 404 ? "This Case could not be found." : result.error?.message ?? "Unable to load this Case.");
					return;
				}
				setCaseRecord(result.data);
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
	}, [caseId]);

	return (
		<main className="case-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/cases">
					<span className="case-brand-mark" aria-hidden="true">S</span>
					SecOpinion
				</Link>
				<nav className="patient-case-nav" aria-label="Patient account">
					<Link className="case-account-link" href="/cases">Your Cases</Link>
					<Link className="case-account-link" href="/cases/new">New Case</Link>
				</nav>
			</header>

			<div className="patient-case-detail-content">
				<Link className="patient-case-back" href="/cases">← Back to Your Cases</Link>
				{isLoading ? (
					<p className="case-loading" role="status">Loading Case details...</p>
				) : loadError ? (
					<section className="patient-case-empty"><h1>Case unavailable</h1><p role="alert">{loadError}</p></section>
				) : caseRecord ? (
					<>
						<div className="patient-case-detail-heading">
							<div>
								<p className="case-kicker">PATIENT WORKSPACE <span>/</span> CASE DETAILS</p>
								<p className="patient-case-id">Case {caseRecord.id}</p>
								<h1>{caseRecord.affectedBodyArea}</h1>
							</div>
							<div className="patient-case-status">
								<strong>{displayStatus(caseRecord.status)}</strong>
								<span>{caseRecord.urgencyTier ?? "Standard"} review</span>
							</div>
						</div>

						<article className="patient-case-detail">
							<p className="patient-case-submitted">Submitted {displayDate(caseRecord.submittedAt)}</p>
							{caseRecord.chargedAmount && <p className="patient-case-fee">Captured fee: ₹{caseRecord.chargedAmount}</p>}
							{caseRecord.refundConfirmedAt && (
								<p className="case-message case-message-success" role="status">
									Refund confirmed{caseRecord.refundedAmount ? `: ₹${caseRecord.refundedAmount}` : ""} on {displayDate(caseRecord.refundConfirmedAt)}.
								</p>
							)}

							<section className="patient-case-detail-section">
								<h2>Condition and recommendation</h2>
								<dl className="patient-case-detail-fields">
									<div><dt>Current condition or diagnosis</dt><dd>{caseRecord.condition}</dd></div>
									<div><dt>Treatment or surgery recommendation</dt><dd>{caseRecord.recommendation}</dd></div>
									{caseRecord.additionalDetails && <div><dt>Additional details</dt><dd>{caseRecord.additionalDetails}</dd></div>}
								</dl>
							</section>

							<section className="patient-case-detail-section">
								<h2>Doctor</h2>
								{caseRecord.doctor ? (
									<div className="patient-case-doctor-detail">
										<strong>{caseRecord.doctor.fullName}</strong>
										{caseRecord.doctor.specialties.length > 0 && <span>{caseRecord.doctor.specialties.join(" · ")}</span>}
									</div>
								) : <p className="patient-case-detail-note">No Doctor is currently assigned.</p>}
							</section>

							<section className="patient-case-detail-section patient-case-documents">
								<h2>Supporting documents</h2>
								{caseRecord.documents.length > 0 ? (
									<ul>{caseRecord.documents.map((document) => (
										<li key={document.id}><a href={`/api/cases/documents/${encodeURIComponent(document.id)}`}>{document.fileName}</a></li>
									))}</ul>
								) : <p className="patient-case-detail-note">No documents are attached.</p>}
							</section>

							{caseRecord.documentRequests.length > 0 && (
								<section className="patient-case-detail-section patient-case-requests">
									<h2>Document requests</h2>
									<ol>{caseRecord.documentRequests.map((request) => (
										<li key={request.id}>
											<p>{request.note}</p>
											<time dateTime={request.createdAt}>{displayDate(request.createdAt)}</time>
											<strong>{request.closedAt ? "Closed" : request.fulfilledAt ? "Documents received" : "Response needed"}</strong>
										</li>
									))}</ol>
								</section>
							)}

							{caseRecord.opinion && (
								<section className="patient-case-detail-section patient-case-opinion">
									<h2>Final Opinion</h2>
									<p>{caseRecord.opinion.text}</p>
									<time dateTime={caseRecord.opinion.createdAt}>{displayDate(caseRecord.opinion.createdAt)}</time>
								</section>
							)}
						</article>
					</>
				) : null}
			</div>
		</main>
	);
}