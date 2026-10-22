export const CASE_STATUSES = [
	"Draft",
	"Submitted",
	"UnderReview",
	"MoreInfoRequested",
	"OpinionGiven",
	"Closed",
	"RefundPending",
	"Refunded",
] as const;

export type CaseStatus = typeof CASE_STATUSES[number];

export const CASE_STATUS_TRANSITIONS: Readonly<Record<CaseStatus, readonly CaseStatus[]>> = {
	Draft: ["Submitted"],
	Submitted: ["UnderReview", "RefundPending"],
	UnderReview: ["MoreInfoRequested", "OpinionGiven", "RefundPending"],
	MoreInfoRequested: ["UnderReview", "RefundPending"],
	OpinionGiven: ["Closed"],
	Closed: [],
	RefundPending: ["Refunded", "UnderReview"],
	Refunded: ["Closed"],
};

export function canTransitionCase(from: CaseStatus, to: CaseStatus): boolean {
	return CASE_STATUS_TRANSITIONS[from].includes(to);
}