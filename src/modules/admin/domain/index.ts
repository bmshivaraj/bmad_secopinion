import { DomainError } from "../../../shared/api-envelope";

export interface AdminAccount {
	id: string;
	username: string;
	passwordHash: string;
	createdAt: Date;
	updatedAt: Date;
}

export class AdminInvalidCredentialsError extends DomainError {
	readonly code = "INVALID_CREDENTIALS";

	constructor() {
		super("Invalid username or password.");
	}
}

export class AdminAccessDeniedError extends DomainError {
	readonly code = "ADMIN_ACCESS_DENIED";

	constructor() {
		super("An Admin session is required for this action.");
	}
}

export class PlatformSettingsUnavailableError extends DomainError {
	readonly code = "PLATFORM_SETTINGS_UNAVAILABLE";

	constructor() {
		super("Platform case fees are not configured.");
	}
}

export class AdminSessionAuthorizationError extends DomainError {
	readonly code = "ADMIN_SESSION_UNAUTHORIZED";

	constructor() {
		super("A valid Admin session is required.");
	}
}

export class InvalidAdminRequestError extends DomainError {
	readonly code = "VALIDATION_ERROR";
}
