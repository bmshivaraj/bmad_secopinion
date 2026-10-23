"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountProfileLink } from "../../components/account-profile-link";

interface PatientProfile {
	displayName: string;
	username: string | null;
	mobileNumber: string;
}

interface ApiResult<T> {
	data: T | null;
	error: { message: string } | null;
}

export default function PatientProfilePage() {
	const [profile, setProfile] = useState<PatientProfile | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState("");
	const [isUnauthorized, setIsUnauthorized] = useState(false);

	useEffect(() => {
		let isCurrent = true;
		fetch("/api/patients/profile", { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ApiResult<PatientProfile> }))
			.then(({ response, result }) => {
				if (!isCurrent) return;
				if (response.status === 401 || response.status === 403) {
					setIsUnauthorized(true);
					return;
				}
				if (!response.ok || result.error || !result.data) {
					setError(result.error?.message ?? "Unable to load your profile.");
					return;
				}
				setProfile(result.data);
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
	}, []);

	return (
		<main className="case-page">
			<header className="case-topbar">
				<Link className="case-brand" href="/cases"><span className="case-brand-mark" aria-hidden="true">S</span>SecOpinion</Link>
				<nav className="patient-case-nav" aria-label="Patient account">
					<Link className="case-account-link" href="/cases">Your Cases</Link>
					<AccountProfileLink role="patient" />
				</nav>
			</header>
			<div className="account-profile-content">
				<p className="case-kicker">PATIENT WORKSPACE <span>/</span> ACCOUNT</p>
				<h1>Patient profile</h1>
				<p className="case-intro">Your registered account details.</p>
				<section className="account-profile-card">
					{isLoading ? <p className="case-loading" role="status">Loading profile...</p>
						: isUnauthorized ? <p className="case-message case-message-error" role="alert">Your Patient session is missing or expired. <Link href="/login">Sign in</Link> to view this profile.</p>
							: error ? <p className="case-message case-message-error" role="alert">{error}</p>
								: profile ? (
									<dl className="account-profile-fields">
										<div><dt>Username</dt><dd>{profile.username ?? "Not set"}</dd></div>
										<div><dt>Mobile number</dt><dd>{profile.mobileNumber}</dd></div>
									</dl>
								) : null}
				</section>
			</div>
		</main>
	);
}