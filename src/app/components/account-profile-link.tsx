"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type AccountRole = "patient" | "doctor" | "admin";

interface ProfileResponse {
	data: { displayName: string } | null;
	error: { message: string } | null;
}

const PROFILE_ROUTES: Record<AccountRole, { api: string; href: string; fallback: string }> = {
	patient: { api: "/api/patients/profile", href: "/patients/profile", fallback: "Patient account" },
	doctor: { api: "/api/doctors/profile/account", href: "/doctors/profile", fallback: "Doctor account" },
	admin: { api: "/api/admin/profile", href: "/admin/profile", fallback: "Admin account" },
};

export function AccountProfileLink({ role }: { role: AccountRole }) {
	const profileRoute = PROFILE_ROUTES[role];
	const [displayName, setDisplayName] = useState(profileRoute.fallback);

	useEffect(() => {
		let isCurrent = true;
		fetch(profileRoute.api, { cache: "no-store" })
			.then(async (response) => ({ response, result: await response.json() as ProfileResponse }))
			.then(({ response, result }) => {
				if (isCurrent && response.ok && !result.error && result.data?.displayName) {
					setDisplayName(result.data.displayName);
				}
			})
			.catch(() => undefined);
		return () => {
			isCurrent = false;
		};
	}, [profileRoute.api]);

	return (
		<Link className="account-profile-link" href={profileRoute.href} aria-label={`${displayName} profile`}>
			<span className="account-profile-name">{displayName}</span>
			<span className="account-profile-label">Profile</span>
		</Link>
	);
}