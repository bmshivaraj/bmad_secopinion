export async function register(): Promise<void> {
	if (process.env.NEXT_RUNTIME !== "nodejs") return;
	const { startDailyCaseSlaBreachJob } = await import("./modules/cases/sla-breach-job");
	const { startDailyDoctorPayoutJob } = await import("./modules/payments/payout-batch-job");
	startDailyCaseSlaBreachJob();
	startDailyDoctorPayoutJob();
}