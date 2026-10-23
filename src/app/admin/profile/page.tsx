"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AccountProfileLink } from "../../components/account-profile-link";

interface AdminProfile {
	displayName: string;
	username: string;
}

interface ApiResult<T> {
	data: T | null;
	error: { message: string } | null;
}

export default function AdminProfilePage() {
	const [profile, setProfile] = useState<AdminProfile | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState("");
	const [isUnauthorized, setIsUnauthorized] = useState(false);

	useEffect(() => {
		let isCurrent = true;
		fetch("/api/admin/profile", { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ApiResult<AdminProfile> }))
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
		<main className="admin-page">
			<header className="admin-topbar">
				<Link className="admin-brand" href="/admin">SecOpinion <span>Admin</span></Link>
				<AccountProfileLink role="admin" />
			</header>
			<section className="account-profile-content">
				<p className="admin-eyebrow">ADMINISTRATION <span>/</span> ACCOUNT</p>
				<h1>Admin profile</h1>
				{isLoading ? <p className="admin-muted" role="status">Loading profile...</p>
					: isUnauthorized ? <p className="admin-error" role="alert">Your Admin session is missing or expired. <Link href="/admin">Sign in</Link> to view this profile.</p>
						: error ? <p className="admin-error" role="alert">{error}</p>
							: profile ? (
								<section className="account-profile-card">
									<dl className="account-profile-fields"><div><dt>Username</dt><dd>{profile.username}</dd></div></dl>
								</section>
							) : null}
				<p className="account-profile-back"><Link href="/admin">Back to Admin dashboard</Link></p>
			</section>
		</main>
	);
}