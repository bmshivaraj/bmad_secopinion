"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

interface ApiResult<T> {
	data: T | null;
	error: { code: string; message: string } | null;
}

interface PayoutProfile {
	upiId: string | null;
}

interface PayoutHistoryEntry {
	caseId: string;
	amount: string;
	status: "Pending" | "Failed" | "Uncertain" | "Succeeded";
	transactionId: string | null;
	createdAt: string;
	updatedAt: string;
}

export default function DoctorProfilePage() {
	const [upiId, setUpiId] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isUnauthorized, setIsUnauthorized] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [loadAttempt, setLoadAttempt] = useState(0);
	const [payoutHistory, setPayoutHistory] = useState<PayoutHistoryEntry[]>([]);
	const [isHistoryLoading, setIsHistoryLoading] = useState(true);
	const [historyError, setHistoryError] = useState("");
	const [error, setError] = useState("");
	const [notice, setNotice] = useState("");

	useEffect(() => {
		let isActive = true;
		fetch("/api/doctors/profile/upi")
			.then(async (response) => ({ response, result: await response.json() as ApiResult<PayoutProfile> }))
			.then(({ response, result }) => {
				if (!isActive) return;
				if (response.status === 401 || response.status === 403) {
					setIsUnauthorized(true);
					return;
				}
				if (!response.ok || result.error || !result.data) {
					setLoadError(result.error?.message ?? "Unable to load your payout details.");
					return;
				}
				setUpiId(result.data.upiId ?? "");
			})
			.catch(() => {
				if (isActive) setLoadError("Unable to connect. Please try again.");
			})
			.finally(() => {
				if (isActive) setIsLoading(false);
			});
		return () => {
			isActive = false;
		};
	}, [loadAttempt]);

	useEffect(() => {
		let isActive = true;
		fetch("/api/doctors/profile/payout-history")
			.then(async (response) => ({ response, result: await response.json() as ApiResult<PayoutHistoryEntry[]> }))
			.then(({ response, result }) => {
				if (!isActive) return;
				if (response.status === 401 || response.status === 403) {
					setIsUnauthorized(true);
					return;
				}
				if (!response.ok || result.error || !result.data) {
					setHistoryError(result.error?.message ?? "Unable to load payout history.");
					return;
				}
				setPayoutHistory(result.data);
			})
			.catch(() => {
				if (isActive) setHistoryError("Unable to connect. Please try again.");
			})
			.finally(() => {
				if (isActive) setIsHistoryLoading(false);
			});
		return () => {
			isActive = false;
		};
	}, [loadAttempt]);

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError("");
		setNotice("");
		setIsSubmitting(true);
		try {
			const response = await fetch("/api/doctors/profile/upi", {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ upiId }),
			});
			const result = await response.json() as ApiResult<PayoutProfile>;
			if (response.status === 401 || response.status === 403) {
				setIsUnauthorized(true);
				return;
			}
			if (!response.ok || result.error || !result.data) {
				setError(result.error?.message ?? "Unable to save your payout details.");
				return;
			}
			setUpiId(result.data.upiId ?? "");
			setNotice("Payout details saved.");
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
					<h1>Your payout details.</h1>
					<p>Keep the destination for future Doctor payouts up to date.</p>
				</div>
				<div className="story-foot">Changes do not alter payouts already disbursed</div>
			</section>
			<section className="auth-panel">
				<div className="auth-form-wrap">
					<Link className="auth-brand auth-mobile-brand" href="/">
						<span className="brand-mark" aria-hidden="true">S</span>
						SecOpinion
					</Link>
					<p className="auth-eyebrow">Doctor settings</p>
					<h2>Payout destination</h2>
					<p className="auth-intro">Your current UPI ID: <strong>{isLoading ? "Loading..." : upiId || "Not set"}</strong></p>
					{isUnauthorized ? (
						<div>
							<p className="auth-error" role="alert">Your Doctor session is missing or expired. Sign in to manage payout details.</p>
							<p className="auth-switch"><Link href="/doctors/login">Doctor sign in</Link></p>
						</div>
					) : (
						<>
							{notice && <p className="auth-success" role="status">{notice}</p>}
							{!isLoading && !loadError && !upiId && <p className="field-hint">Payouts cannot be sent until a valid UPI ID is saved.</p>}
							{!isLoading && !loadError && (
								<form className="auth-form" onSubmit={handleSubmit}>
									<div className="field-group">
										<label htmlFor="upiId">UPI ID</label>
										<input
											id="upiId"
											name="upiId"
											type="text"
											value={upiId}
											onChange={(event) => setUpiId(event.target.value)}
											autoComplete="off"
											maxLength={255}
											pattern={"[A-Za-z0-9]+(?:[._\\x2D][A-Za-z0-9]+)*@[A-Za-z0-9]+(?:[.\\x2D][A-Za-z0-9]+)*"}
											title="Use local-part@handle format, such as name@bank"
											required
										/>
										<span className="field-hint">Use local-part@handle format. Bank/NPCI verification is not performed.</span>
									</div>
									{error && <p className="auth-error" role="alert">{error}</p>}
									<button className="auth-submit" type="submit" disabled={isSubmitting}>
										{isSubmitting ? "Saving..." : "Save UPI ID"}
									</button>
								</form>
							)}
							{isLoading && <p className="field-hint" role="status">Loading payout details...</p>}
							{!isLoading && loadError && (
								<div>
									<p className="auth-error" role="alert">{loadError}</p>
									<button className="auth-secondary" type="button" onClick={() => {
										setIsLoading(true);
										setLoadError("");
										setIsHistoryLoading(true);
										setHistoryError("");
										setLoadAttempt((attempt) => attempt + 1);
									}}>Retry</button>
								</div>
							)}
							<section className="payout-history" aria-labelledby="payout-history-title">
								<h3 id="payout-history-title">Payout history</h3>
								{isHistoryLoading && <p className="field-hint" role="status">Loading payout history...</p>}
								{!isHistoryLoading && historyError && (
									<div>
										<p className="auth-error" role="alert">{historyError}</p>
										<button className="auth-secondary" type="button" onClick={() => {
											setIsHistoryLoading(true);
											setHistoryError("");
											setLoadAttempt((attempt) => attempt + 1);
										}}>Retry history</button>
									</div>
								)}
								{!isHistoryLoading && !historyError && payoutHistory.length === 0 && (
									<p className="field-hint">No payouts yet.</p>
								)}
								{!isHistoryLoading && !historyError && payoutHistory.length > 0 && (
									<ol className="payout-history-list">
										{payoutHistory.map((entry) => (
											<li className="payout-history-item" key={entry.caseId}>
												<div>
													<strong>Case {entry.caseId}</strong>
													<span>Updated {new Date(entry.updatedAt).toLocaleDateString()}</span>
													{entry.transactionId && <span>Transfer ref {entry.transactionId}</span>}
												</div>
												<div className="payout-history-value">
													<strong>₹{entry.amount}</strong>
													<span>{entry.status}</span>
												</div>
											</li>
										))}
									</ol>
								)}
							</section>
						</>
					)}
				</div>
			</section>
		</main>
	);
}
