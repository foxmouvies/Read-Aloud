/* Firefox: closed <details> through the REAL popup flow (real popup button -> production dispatcher -> content handler)
 * on a live localhost page. The same page is served twice, details closed and details open; the open copy must give
 * exactly the closed body's sentences more. Reuses the firefox-msgflow driver (only=start mode). Voices are the
 * driver's stand-ins and speak() is a no-op, so this proves the extracted sentence count, not audible speech. */
const { execSync, spawn } = require("child_process");
const fs = require("fs"), path = require("path"), http = require("http");
const EXT_DIR = path.resolve(__dirname, "..");
const S = (n) => `Sentence number ${n} of this details check is written long enough to be a sentence of its own.`;
const page = (open) => `<html><head><title>Details flow</title></head><body><article><h1>Details flow check heading</h1>
<p>${S(1)} ${S(2)}</p>
<details${open ? " open" : ""}><summary>Closed section summary line stays readable.</summary><p>${S(3)} ${S(4)}</p><p>${S(5)}</p></details>
<p>${S(6)} ${S(7)}</p></article></body></html>`;
const run = (name, env) => {
  const out = execSync(`node test/firefox-msgflow.js`, { cwd: EXT_DIR, env: Object.assign({}, process.env, env), timeout: 100000 }).toString();
  const m = /Read this page with an online en-US voice, no opt-in, reading (\d+) sentences/.exec(out);
  return { out, total: m ? Number(m[1]) : null };
};
(async () => {
  const a = run("closed", { MSGFLOW_PAGE: "details-closed.html" });
  const b = run("open", { MSGFLOW_PAGE: "details-open.html" });
  console.log("closed total:", a.total, "open total:", b.total);
  let fail = 0; const chk = (c, m) => { console.log((c ? "  ok: " : "  FAIL: ") + m); if (!c) fail++; };
  chk(a.total > 0 && b.total > 0, "both pages produced sentences");
  chk(b.total - a.total === 3, `open copy has exactly the 3 closed-body sentences more (diff ${b.total - a.total})`);
  console.log(fail ? "FIREFOX DETAILS FLOW: FAIL" : "FIREFOX DETAILS FLOW: PASS (stand-in voices, no audible speech)"); process.exit(fail ? 1 : 0);
})();
