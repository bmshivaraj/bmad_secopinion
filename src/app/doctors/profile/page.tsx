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

export default function DoctorProfilePage() {
	const [upiId, setUpiId] = useState("");
	const [isLoading, setIsLoading] = useState(true);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [isUnauthorized, setIsUnauthorized] = useState(false);
	const [loadError, setLoadError] = useState("");
	const [loadAttempt, setLoadAttempt] = useState(0);
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
										setLoadAttempt((attempt) => attempt + 1);
									}}>Retry</button>
								</div>
							)}
						</>
					)}
				</div>
			</section>
		</main>
	);
}