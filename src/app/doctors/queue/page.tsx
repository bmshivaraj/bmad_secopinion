"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

interface ApiResult<T> {
	data: T | null;
	error: { message: string } | null;
}

interface QueueCase {
	id: string;
	affectedBodyArea: string;
	condition: string;
	recommendation: string;
	additionalDetails: string;
	specialtyId: string | null;
	urgencyTier: "Standard" | "Urgent" | null;
	status: string;
	doctorId: string | null;
	assignmentLockVersion: number;
	submittedAt: string | null;
	elapsedSlaMs: number | null;
	remainingSlaMs: number | null;
}

interface CaseDocument {
	id: string;
	fileName: string;
	contentType: string;
	sizeBytes: number;
	createdAt: string;
}

interface CaseDetail extends QueueCase {
	documents: CaseDocument[];
}

function formatRemainingTime(milliseconds: number | null): string {
	if (milliseconds === null) return "SLA unavailable";
	if (milliseconds <= 0) return "SLA elapsed";
	if (milliseconds < 60 * 1000) return "<1m remaining";
	const totalHours = Math.floor(milliseconds / (60 * 60 * 1000));
	const days = Math.floor(totalHours / 24);
	const hours = totalHours % 24;
	return days > 0 ? `${days}d ${hours}h remaining` : `${hours}h ${Math.floor((milliseconds % (60 * 60 * 1000)) / (60 * 1000))}m remaining`;
}

function formatSubmittedAt(value: string | null): string {
	return value ? new Date(value).toLocaleString() : "Submission time unavailable";
}

export default function DoctorQueuePage() {
	const [cases, setCases] = useState<QueueCase[]>([]);
	const [activeCase, setActiveCase] = useState<CaseDetail | null>(null);
	const detailRequestId = useRef(0);
	const [isLoading, setIsLoading] = useState(true);
	const [isLoadingDetail, setIsLoadingDetail] = useState(false);
	const [isUnauthorized, setIsUnauthorized] = useState(false);
	const [isForbidden, setIsForbidden] = useState(false);
	const [error, setError] = useState("");
	const [detailError, setDetailError] = useState("");
	const [claimError, setClaimError] = useState("");
	const [claimNotice, setClaimNotice] = useState("");
	const [busyClaimCaseId, setBusyClaimCaseId] = useState<string | null>(null);
	const [refreshKey, setRefreshKey] = useState(0);

	useEffect(() => {
		let isCurrent = true;
		setIsLoading(true);
		setError("");
		fetch("/api/doctors/queue", { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ApiResult<QueueCase[]> }))
			.then(({ response, result }) => {
				if (!isCurrent) return;
				setIsUnauthorized(response.status === 401);
				setIsForbidden(response.status === 403);
				if (!response.ok || result.error || !result.data) {
					setCases([]);
					if (response.status !== 401 && response.status !== 403) setError(result.error?.message ?? "Unable to load the Doctor queue.");
					return;
				}
				setCases(result.data);
				setActiveCase(null);
			})
			.catch(() => {
				if (isCurrent) setError("Unable to connect. Please try again.");
			})
			.finally(() => {
				if (isCurrent) setIsLoading(false);
			});
		return () => {
			isCurrent = false;
		};
	}, [refreshKey]);

	function refreshQueue() {
		detailRequestId.current += 1;
		setActiveCase(null);
		setDetailError("");
		setIsLoadingDetail(false);
		setRefreshKey((current) => current + 1);
	}

	async function openCase(caseId: string) {
		const requestId = ++detailRequestId.current;
		setIsLoadingDetail(true);
		setActiveCase(null);
		setDetailError("");
		try {
			const response = await fetch(`/api/doctors/queue/${encodeURIComponent(caseId)}`, { cache: "no-store" });
			const result = await response.json() as ApiResult<CaseDetail>;
			if (requestId !== detailRequestId.current) return;
			if (!response.ok || result.error || !result.data) {
				setDetailError(result.error?.message ?? "Unable to load this Case.");
				return;
			}
			setActiveCase(result.data);
		} catch {
			if (requestId === detailRequestId.current) setDetailError("Unable to connect. Please try again.");
		} finally {
			if (requestId === detailRequestId.current) setIsLoadingDetail(false);
		}
	}

	async function claimCase(caseRecord: QueueCase) {
		setBusyClaimCaseId(caseRecord.id);
		setClaimError("");
		setClaimNotice("");
		try {
			const response = await fetch(`/api/doctors/queue/${encodeURIComponent(caseRecord.id)}/claim`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ expectedVersion: caseRecord.assignmentLockVersion }),
			});
			const result = await response.json() as ApiResult<{ id: string }>;
			if (response.status === 401 || response.status === 403) {
				setIsUnauthorized(response.status === 401);
				setIsForbidden(response.status === 403);
				setCases([]);
				return;
			}
			if (!response.ok || result.error || !result.data) {
				setClaimError(result.error?.message ?? "Unable to claim this Case.");
				if (response.status === 409) refreshQueue();
				return;
			}
			setClaimNotice(`Case ${caseRecord.id} is now assigned to you.`);
			refreshQueue();
		} catch {
			setClaimError("Unable to confirm whether the claim completed. Refreshing the queue.");
			refreshQueue();
		} finally {
			setBusyClaimCaseId(null);
		}
	}

	async function signOut() {
		await fetch("/api/doctors/logout", { method: "POST" }).catch(() => undefined);
		window.location.assign("/doctors/login");
	}

	return (
		<main className="doctor-queue-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/">
					<span className="case-brand-mark" aria-hidden="true">S</span>
					SecOpinion
				</Link>
				<nav className="doctor-queue-nav" aria-label="Doctor account">
					<Link className="case-account-link" href="/doctors/profile">Payout details</Link>
					<button className="admin-signout" type="button" onClick={() => void signOut()}>Sign out</button>
				</nav>
			</header>
			<section className="doctor-queue-content">
				<div className="doctor-queue-heading">
					<div>
						<p className="case-kicker">Doctor workspace <span>/</span> Cases</p>
						<h1>Review queue</h1>
						<p className="doctor-queue-intro">Cases matched to your registered specialties.</p>
					</div>
					<div className="doctor-queue-actions">
						{!isLoading && !isUnauthorized && !isForbidden && <span>{cases.length} Cases</span>}
						<button className="case-button case-button-secondary" type="button" onClick={refreshQueue} disabled={isLoading}>
							Refresh queue
						</button>
					</div>
				</div>

				{claimNotice && <p className="admin-notice" role="status">{claimNotice}</p>}
				{claimError && <p className="admin-error" role="alert">{claimError}</p>}

				{isUnauthorized ? (
					<section className="doctor-queue-message"><h2>Sign in required</h2><p>Your Doctor session is missing or expired.</p><Link href="/doctors/login">Doctor sign in</Link></section>
				) : isForbidden ? (
					<section className="doctor-queue-message"><h2>Verification required</h2><p>Only currently Verified Doctors can access Case queues.</p></section>
				) : isLoading ? (
					<p className="case-loading" role="status">Loading your queue...</p>
				) : error ? (
					<section className="doctor-queue-message"><h2>Queue unavailable</h2><p role="alert">{error}</p></section>
				) : cases.length === 0 ? (
					<section className="doctor-queue-message"><h2>No matching Cases</h2><p>There are no submitted Cases for your specialties right now.</p></section>
				) : (
					<div className="doctor-queue-layout">
						<div className="doctor-case-list" aria-label="Matching Cases">
							{cases.map((caseRecord) => (
								<article className={`doctor-case-row${activeCase?.id === caseRecord.id ? " is-active" : ""}`} key={caseRecord.id}>
									<div className="doctor-case-row-main">
										<div className="doctor-case-title-row">
											<h2>{caseRecord.affectedBodyArea}</h2>
											{caseRecord.urgencyTier === "Urgent" ? <span className="doctor-urgency doctor-urgency-urgent">Urgent</span> : <span className="doctor-urgency">Standard</span>}
										</div>
										<p>{caseRecord.condition}</p>
										<div className="doctor-case-meta">
											<span>{caseRecord.status.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
											<time dateTime={caseRecord.submittedAt ?? undefined}>{formatSubmittedAt(caseRecord.submittedAt)}</time>
										</div>
									</div>
									<div className="doctor-case-row-end">
										<strong className={caseRecord.remainingSlaMs !== null && caseRecord.remainingSlaMs <= 24 * 60 * 60 * 1000 ? "doctor-sla-near" : ""}>
											{formatRemainingTime(caseRecord.remainingSlaMs)}
										</strong>
										{caseRecord.doctorId === null && caseRecord.status === "Submitted" && (
											<button
												className="doctor-open-case"
												type="button"
												disabled={busyClaimCaseId !== null}
												onClick={() => void claimCase(caseRecord)}
											>
												{busyClaimCaseId === caseRecord.id ? "Claiming..." : "Claim Case"}
											</button>
										)}
										<button className="doctor-open-case" type="button" disabled={isLoadingDetail} onClick={() => void openCase(caseRecord.id)}>
											{activeCase?.id === caseRecord.id ? "Viewing" : "View Case"}
										</button>
									</div>
								</article>
							))}
						</div>

						{isLoadingDetail && <section className="doctor-case-detail"><p role="status">Loading Case...</p></section>}
						{detailError && <section className="doctor-case-detail"><p className="auth-error" role="alert">{detailError}</p></section>}
						{activeCase && !isLoadingDetail && !detailError && (
							<section className="doctor-case-detail" aria-labelledby="doctor-case-detail-heading">
								<div className="doctor-case-detail-heading">
									<div><p className="admin-eyebrow">Case details</p><h2 id="doctor-case-detail-heading">{activeCase.affectedBodyArea}</h2></div>
									<button className="doctor-open-case" type="button" onClick={() => {
										detailRequestId.current += 1;
										setActiveCase(null);
										setDetailError("");
										setIsLoadingDetail(false);
									}}>Close</button>
								</div>
								<p className="doctor-detail-condition">{activeCase.condition}</p>
								<dl className="doctor-detail-fields">
									<div><dt>Patient-provided recommendation</dt><dd>{activeCase.recommendation}</dd></div>
									{activeCase.additionalDetails && <div><dt>Additional details</dt><dd>{activeCase.additionalDetails}</dd></div>}
									<div><dt>Response SLA</dt><dd>{formatRemainingTime(activeCase.remainingSlaMs)}</dd></div>
								</dl>
								{activeCase.documents.length > 0 && (
									<div className="doctor-case-documents">
										<h3>Documents</h3>
										<ul>{activeCase.documents.map((document) => (
											<li key={document.id}><a href={`/api/cases/documents/${encodeURIComponent(document.id)}`}>{document.fileName}</a><span>{document.contentType}</span></li>
										))}</ul>
									</div>
								)}
							</section>
						)}
					</div>
				)}
			</section>
		</main>
	);
}