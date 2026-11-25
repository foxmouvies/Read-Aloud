/*
 * Firefox unmodified popup-flow test: a test-only driver page (sideloaded
 * with a test build that adds a localhost host permission) loads the REAL
 * popup unmodified in an iframe and clicks its real buttons against a real
 * localhost page. The full production path runs end to end: popup click ->
 * production dispatcher install + file injection -> production dispatcher ->
 * production content handler. This covers everything in the
 * popup-to-content-script flow except the toolbar-button click itself,
 * which no automation API can perform in Firefox headless.
 * Run: node test/firefox-msgflow.js   (needs the speech stack env like firefox-e2e)
 */
const { execSync, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const EXT_DIR = path.resolve(__dirname, "..");
const EXT_ID = "readaloud@instinct.local";
const FF_UUID = "11111111-2222-3333-4444-555555555555";
const GECKODRIVER = process.env.GECKODRIVER || "geckodriver";
const FIREFOX = process.env.FIREFOX_BIN || "firefox-esr";
const PORT = 9888;
const WEB_PORT = 8917;
const BASE = `http://127.0.0.1:${PORT}`;
let SID = null;

function req(method, url, body) {
  return new Promise((resolve, reject) => {
    const r = http.request(url, { method, headers: { "Content-Type": "application/json" } }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
const get = (u) => req("GET", u);
const post = (u, b) => req("POST", u, b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function execute(script, args) {
  const r = await post(`${BASE}/session/${SID}/execute/sync`, { script, args: args || [] });
  return r.value;
}
async function waitFor(desc, fn, timeoutMs) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e.message; }
    await sleep(500);
  }
  throw new Error("TIMEOUT waiting for: " + desc + " (last: " + JSON.stringify(last) + ")");
}

(async () => {
  // Fixture server.
  const { COMPLEX_HTML } = require("./fixtures/pages.js");
  let postedResult = null;
  const server = http.createServer((rq, rs) => {
    if (rq.url === "/result" && rq.method === "POST") {
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => { try { postedResult = JSON.parse(body); } catch (e) { postedResult = { error: "bad-result-post" }; } rs.end("ok"); });
      return;
    }
    rs.setHeader("Content-Type", "text/html");
    rs.end(rq.url.includes("complex") ? COMPLEX_HTML : "<html><body>index</body></html>");
  });
  await new Promise((r) => server.listen(WEB_PORT, "127.0.0.1", r));

  // Test build: full source + driver page + localhost host permission.
  execSync(`rm -rf /tmp/ra-msgflow-ext && mkdir -p /tmp/ra-msgflow-ext/test/driver`);
  execSync(`cp -r manifest.json shared content popup reader icons vendor /tmp/ra-msgflow-ext/`, { cwd: EXT_DIR });
  execSync(`cp test/driver/driver.html test/driver/driver.js test/driver/ping.js test/driver/ping2.js /tmp/ra-msgflow-ext/test/driver/`, { cwd: EXT_DIR });
  const man = JSON.parse(fs.readFileSync("/tmp/ra-msgflow-ext/manifest.json", "utf8"));
  man.host_permissions = ["http://127.0.0.1/*"];
  if (process.env.MSGFLOW_PROBES) man.content_scripts = [{ matches: ["http://127.0.0.1/*"], js: ["test/driver/ping.js"] }];
  if (process.env.MSGFLOW_DECLARED) man.content_scripts = [{ matches: ["http://127.0.0.1/*"], js: ["shared/store.js", "shared/text.js", "shared/tts-engine.js", "content/read-page.js"], run_at: "document_idle" }];
  fs.writeFileSync("/tmp/ra-msgflow-ext/manifest.json", JSON.stringify(man, null, 2));

  execSync(`cd /tmp/ra-msgflow-ext && zip -qr /tmp/ra-ff-msgflow.zip .`);
  execSync(`rm -rf /tmp/ff-prof-mf && mkdir -p /tmp/ff-prof-mf/extensions && cp /tmp/ra-ff-msgflow.zip "/tmp/ff-prof-mf/extensions/${EXT_ID}.xpi"`);
  fs.writeFileSync("/tmp/ff-prof-mf/user.js", [
    'user_pref("xpinstall.signatures.required", false);',
    'user_pref("extensions.autoDisableScopes", 0);',
    'user_pref("extensions.enabledScopes", 15);',
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("app.update.disabledForTesting", true);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("media.webspeech.synth.enabled", true);',
    `user_pref("extensions.webextensions.uuids", '{"${EXT_ID}":"${FF_UUID}"}');`
  ].join("\n"));
  execSync("rm -f /tmp/ff-prof-mf.zip && cd /tmp/ff-prof-mf && zip -qr /tmp/ff-prof-mf.zip .");
  const profileB64 = fs.readFileSync("/tmp/ff-prof-mf.zip").toString("base64");

  const gecko = spawn(GECKODRIVER, ["-p", String(PORT)], { stdio: ["ignore", "ignore", "inherit"] });
  const cleanup = async () => {
    try { if (SID) await req("DELETE", `${BASE}/session/${SID}`); } catch (e) {}
    gecko.kill(); server.close();
  };
  process.on("SIGINT", async () => { await cleanup(); process.exit(1); });

  try {
    await waitFor("geckodriver ready", async () => {
      try { await get(`${BASE}/status`); return true; } catch (e) { return false; }
    }, 20000);

    const sess = await post(`${BASE}/session`, {
      capabilities: {
        alwaysMatch: {
          "moz:firefoxOptions": {
            binary: FIREFOX,
            profile: profileB64,
            args: ["-headless", `moz-extension://${FF_UUID}/test/driver/driver.html?port=${WEB_PORT}${process.env.MSGFLOW_PROBES ? "&probes=1" : ""}`]
          }
        }
      }
    });
    SID = sess.value.sessionId;
    console.log("session:", SID);

    // The fixture tab is the active one (the real popup needs it active), so
    // the driver posts its result to the fixture server instead of the title.
    const result = await waitFor("driver result post", async () => postedResult, 95000).catch(async (e) => {
      const u = (await get(`${BASE}/session/${SID}/url`)).value;
      const t = (await get(`${BASE}/session/${SID}/title`)).value;
      console.log("DEBUG:", JSON.stringify({ u, t }));
      throw e;
    });
    console.log("DRIVER RESULT:", JSON.stringify(result));
    if (result && result.error) throw new Error("driver reported FAIL: " + result.error);
    if (!result || result.popupLoaded !== true) throw new Error("the real popup did not load in the driver");

    const g = result.gatedStatus || "";
    const sg = result.stateAfterGate || {};
    if (!(g.includes("No English (United States) voice") && sg.state === "idle")) {
      throw new Error("voice gate did not refuse remote-by-default via the real popup: " + JSON.stringify({ status: g, state: sg }));
    }
    console.log("POPUP FLOW: Read this page refused with only a French voice listed (real popup status shown, engine idle)");

    if (!/^Reading \d+ sentences in French \(France\)\.$/.test(result.frenchManualStatus || "")) throw new Error("popup Language control (French) did not start French reading: " + result.frenchManualStatus);
    console.log("POPUP FLOW: Language control set to French (France) in the real popup started reading in French (manual choice): " + result.frenchManualStatus);

    const sm = /^Reading (\d+) sentences/.exec(result.startStatus || "");
    const st = result.stateAfterStart || {};
    if (!(sm && Number(sm[1]) > 0 && st.total > 0 && st.state !== "idle")) {
      throw new Error("Read this page with an online en-US voice failed via the real popup: " + JSON.stringify({ status: result.startStatus, state: st }));
    }
    console.log("POPUP FLOW: Read this page with an online en-US voice, no opt-in, reading", st.total, "sentences (real popup button)");

    const expectedKey = `page:http://127.0.0.1:${WEB_PORT}/complex.html`;
    const rt = result.positionRoundTrip || {};
    if (!(rt.key === expectedKey && rt.idx === 3)) {
      throw new Error("web position save/load round-trip failed: " + JSON.stringify(rt));
    }
    if (rt.key.includes("?")) throw new Error("position key leaks query string: " + rt.key);
    console.log("POPUP FLOW: web position save/load round-trip OK under", rt.key);
    if ((result.positionKeys || []).length) {
      console.log("POPUP FLOW: speech-event-driven save also recorded", JSON.stringify(result.positionKeys));
    } else {
      console.log("POPUP FLOW: speech events do not fire in this environment's web context (0 voices); round-trip covers save/load wiring");
    }
    const rs = result.stateAfterResume || {};
    if (!(/^Reading /.test(result.resumedStatus || "") && rs.sentenceIndex === 2)) {
      throw new Error("web resume after reload did not start at saved sentence 3: " + JSON.stringify({ status: result.resumedStatus, state: rs }));
    }
    if (result.dispatcherFlag !== true) throw new Error("production dispatcher flag missing after reinjection");
    console.log("POPUP FLOW: after reload, real-popup reinjection (idempotent dispatcher) resumed at saved sentence", rs.sentenceIndex + 1, "of", rs.total);

    if (!((result.selectionEmptyStatus || "").includes("Select some text"))) {
      throw new Error("Read selected text without a selection did not refuse cleanly: " + JSON.stringify(result.selectionEmptyStatus));
    }
    console.log("POPUP FLOW: Read selected text without a selection refused via the real popup");
    const ss = result.stateAfterSelection || {};
    if (!(/^Reading /.test(result.selectionStatus || "") && ss.state !== "idle" && ss.total > 0)) {
      throw new Error("Read selected text with a selection failed: " + JSON.stringify({ status: result.selectionStatus, state: ss }));
    }
    if (!(ss.total < st.total)) {
      throw new Error("READ_SELECTION read the whole page instead of the selection: " + JSON.stringify({ selection: ss.total, page: st.total }));
    }
    console.log("POPUP FLOW: Read selected text read the selected text only (", ss.total, "of", st.total, "page sentences)");
    if (!((result.rateLabel || "").startsWith("1.3"))) throw new Error("popup speed slider did not update: " + JSON.stringify(result.rateLabel));
    const srt = result.setRateResponse || {};
    if (!(srt.ok === true)) throw new Error("SET_RATE not acknowledged over the production dispatcher: " + JSON.stringify(srt));
    console.log("POPUP FLOW: speed slider drove SET_RATE through the real popup; protocol ack over production dispatcher");
    console.log("FIREFOX UNMODIFIED POPUP FLOW: PASS");
  } finally {
    await cleanup();
  }
})().catch((e) => { console.error("FIREFOX MESSAGE FLOW: FAIL:", e.message); process.exit(1); });
