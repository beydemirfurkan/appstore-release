// Following a submission through review: re-read the readiness report until the
// verdict leaves "in-review" or time runs out. Apple's review takes hours to
// days, so this is for CI jobs and agents that want the outcome, not a person
// at a terminal — and it is always bounded.

import { getReadinessReport } from "./report.mjs";

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ minutes: number, pollSeconds?: number, onTick?: (elapsedMinutes: number) => void }} options
 * @returns {Promise<{ report: import("./report.mjs").ReadinessReport, timedOut: boolean, waitedMinutes: number }>}
 */
export async function waitForReview(ctx, { minutes, pollSeconds = 60, onTick }) {
  const started = Date.now();
  const deadline = started + minutes * 60_000;
  let report = await getReadinessReport(ctx);
  while (report.verdict === "in-review" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.max(0, Math.min(pollSeconds * 1000, deadline - Date.now()))));
    onTick?.(Math.round((Date.now() - started) / 60_000));
    report = await getReadinessReport(ctx);
  }
  return {
    report,
    timedOut: report.verdict === "in-review",
    waitedMinutes: Math.round(((Date.now() - started) / 60_000) * 10) / 10,
  };
}
