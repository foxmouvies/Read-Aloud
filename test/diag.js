/* Test-runner diagnostics. A killed or timed-out run used to end with puppeteer's "frame got detached" (the browser is
 * closed under a pending wait), which hides the real cause. This helper records the last output line as the current
 * step and, when the process is terminated by a signal or exceeds RA_TEST_BUDGET_MS (default 170000), prints
 * "TIMEOUT/KILLED ... last step: ..." so a timeout is never mistaken for a page navigation or crash. */
"use strict";
let last = "(no output yet)"; const t0 = Date.now();
const log = console.log.bind(console);
console.log = (...a) => { last = a.join(" ").slice(0, 160); log(...a); };
const say = (why) => { log(`${why} after ${Math.round((Date.now() - t0) / 1000)}s, last step: ${last}`); };
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { say("KILLED by " + sig + " (runner time limit)"); process.exit(124); });
const budget = Number(process.env.RA_TEST_BUDGET_MS || 170000);
setTimeout(() => { say("TIMEOUT (budget " + budget + "ms)"); process.exit(124); }, budget).unref();
module.exports = { step: (s) => { last = s; } };
