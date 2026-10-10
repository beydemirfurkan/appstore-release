// Is this version ready to submit, and if not, what exactly is in the way?
// The whole answer is returned as structured data; the text is a rendering of it.

import { Status } from "../core/status.mjs";
import { getReadinessReport } from "../report/report.mjs";

/** @type {import("./registry.mjs").OperationMeta} */
export const meta = {
  id: "check",
  title: "Readiness check",
  phase: "listing",
  needs: [],
  mutates: false,
  args: {
    compact: {
      type: "boolean",
      default: false,
      description: "show the verdict, what is wrong and what to do next — not the sections that are fine",
    },
  },
};

/**
 * @param {import("../core/context.mjs").Context} ctx
 * @param {{ compact?: boolean }} [args]
 */
export async function run(ctx, args = {}) {
  const report = await getReadinessReport(ctx);
  ctx.log.report(report, { compact: Boolean(args.compact) });

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
