export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startDailyCaseSlaBreachJob } = await import("./modules/cases/sla-breach-job");
	startDailyCaseSlaBreachJob();
}