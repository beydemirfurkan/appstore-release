// Is this version ready to submit, and if not, what exactly is in the way?
// The whole answer is returned as structured data; the text is a rendering of it.

import { Status } from "../core/status.mjs";
import { getReadinessReport } from "../report/report.mjs";
import { renderReportText } from "../report/render.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "check",
  title: "Readiness check",
  phase: "listing",
  needs: [],
  mutates: false,
};

/** @param {import("../core/context.mjs").Context} ctx */
export async function run(ctx) {
  const report = await getReadinessReport(ctx);
  for (const line of renderReportText(report).split("\n")) ctx.log.info(line);

  // The UI-only step is an ordinary finding, not a result injected straight
  // into the logger — so every surface sees it the same way. Never ERROR:
  // reading the state succeeded even when the state is bad. The verdict and
  // the findings carry the bad news, and they drive the exit code. MANUAL only
  // when a person is genuinely all that is left.
  return {
    status: report.verdict === "needs-human" ? Status.MANUAL : Status.OK,
    message: `${report.verdict}${report.summary.blockers ? ` · ${report.summary.blockers} blocking` : ""}`,
    details: report,
    findings: report.findings,
  };
}
