import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountProfileLink } from "./account-profile-link";

const profileLinks = [
	{ role: "patient" as const, fallback: "Patient account", href: "/patients/profile" },
	{ role: "doctor" as const, fallback: "Doctor account", href: "/doctors/profile" },
	{ role: "admin" as const, fallback: "Admin account", href: "/admin/profile" },
];

for (const profile of profileLinks) {
	test(`${profile.role} account link renders its fallback identity and profile destination`, () => {
		const markup = renderToStaticMarkup(<AccountProfileLink role={profile.role} />);
		assert.match(markup, new RegExp(`href="${profile.href}"`));
		assert.match(markup, new RegExp(profile.fallback));
		assert.match(markup, />Profile<\/span>/);
	});
}