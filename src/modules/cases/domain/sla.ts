import type { CaseRecord } from "./index";

export const CASE_RESPONSE_SLA_MS = 120 * 60 * 60 * 1000;

interface PauseInterval {
	pausedAt: Date;
	resumedAt: Date | null;
}

function asDate(value: unknown): Date | null {
	const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
	return date && Number.isFinite(date.getTime()) ? date : null;
}

function readPauseIntervals(value: CaseRecord["slaPauseHistory"]): PauseInterval[] {
	if (!Array.isArray(value)) return [];
	const intervals: PauseInterval[] = [];
	for (const item of value) {
		if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
		const pausedAt = asDate(item.pausedAt);
		const resumedAt = item.resumedAt === null ? null : asDate(item.resumedAt);
		if (pausedAt && (item.resumedAt === null || resumedAt)) intervals.push({ pausedAt, resumedAt });
	}
	return intervals;
}

export function computeElapsedSlaTime(caseRecord: Pick<CaseRecord, "submittedAt" | "slaPauseHistory">, now = new Date()): number | null {
	if (!caseRecord.submittedAt) return null;
	const submittedAt = caseRecord.submittedAt.getTime();
	const nowMs = now.getTime();
	if (!Number.isFinite(submittedAt) || !Number.isFinite(nowMs)) return null;
	const elapsedMs = Math.max(0, nowMs - submittedAt);
	const pauses = readPauseIntervals(caseRecord.slaPauseHistory)
		.map(({ pausedAt, resumedAt }) => ({
			start: Math.max(submittedAt, pausedAt.getTime()),
			end: Math.min(nowMs, resumedAt?.getTime() ?? nowMs),
		}))
		.filter(({ start, end }) => end > start)
		.sort((left, right) => left.start - right.start);

	let pausedMs = 0;
	let currentEnd = submittedAt;
	for (const interval of pauses) {
		const start = Math.max(interval.start, currentEnd);
		if (interval.end > start) pausedMs += interval.end - start;
		currentEnd = Math.max(currentEnd, interval.end);
	}
	return Math.max(0, elapsedMs - pausedMs);
}