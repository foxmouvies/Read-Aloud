/* Experimental prototype: adds Piper voices to window.speechSynthesis so the unmodified reader/engine can use them.
 * Voice files come from the upstream rhasspy/piper-voices repository. Not shipped. */
(function () {
  var ROOT = (document.currentScript.src || "").replace(/[^/]*$/, "");
  var native = window.speechSynthesis, NativeUtter = window.SpeechSynthesisUtterance;
  var PV = [
    { name: "Piper Alba", lang: "en-GB", voiceURI: "piper:en_GB-alba-medium", localService: true, default: false, optIn: true, piperId: "en_GB-alba-medium", credit: "Voice data: Alba dataset, University of Edinburgh (datashare.ed.ac.uk/handle/10283/3270), licensed CC BY 4.0 per the voice model card." },
    { name: "Piper Siwis", lang: "fr-FR", voiceURI: "piper:fr_FR-siwis-medium", localService: true, default: false, optIn: true, piperId: "fr_FR-siwis-medium", credit: "Voice data: SIWIS dataset, University of Edinburgh (datashare.is.ed.ac.uk/handle/10283/2353), licensed CC-BY 4.0 per the voice model card." }
  ];
  var unlockCtx = function(){ if(!ctx) ctx = new AudioContext(); if(ctx.state==="suspended") ctx.resume(); };
  /* Unlock audio inside the user click/key gesture, before any synthesis finishes. */
  document.addEventListener("click", function () { try { unlockCtx(); } catch (e) {} }, true); document.addEventListener("keydown", function () { try { unlockCtx(); } catch (e) {} }, true);
  var EXPECT = { 'en_GB-alba-medium': [63221984, 6295], 'fr_FR-siwis-medium': [63221984, 6369] }, allow = {}, okIds = {}; /* same sizes the worker checks; allow[id] is set only while the user's Download now is running */
  var sessions = {}, ctx = null, cur = null, gen = 0, paused = false;
    var P = { pf: { started: 0, discarded: 0 } };
  function ev() {}
  function Utter(text) { this.text = text; this.voice = null; this.lang = ""; this.rate = 1; this.pitch = 1; this.volume = 1; }
  function toNative(u) { var n = new NativeUtter(u.text); n.lang = u.lang; n.rate = u.rate; n.pitch = u.pitch; n.volume = u.volume; if (u.voice) n.voice = u.voice;
    ["onstart", "onend", "onerror", "onboundary"].forEach(function (k) { n[k] = function (e) { if (u[k]) u[k](e); }; }); return n; }
  var cache = null; P.pf = { hits: 0, misses: 0, discarded: 0, started: 0 };
  function getWav(id, text) {
    var key = id + "|" + text;
    if (cache && cache.key === key) { P.pf.hits++; var c = cache; cache = null; return c.p; }
    P.pf.misses++; return run(id, text);
  }
  var worker = null, wcb = {}, wid = 0, lastMsg = 0;
  /* ---- Piper download / progress / cancel line (test-only UI) ---- */
  var UI = (function () {
    var sel = null, box = null, txt, bar, bDl, bCx, bRm, lastSys = null, state = "none", loadedIds = {}, curName = "Piper", mb = function (n) { return (n / 1e6).toFixed(1); };
    function init() {
      sel = document.getElementById("voice"); if (!sel || box) return;
      var st = document.createElement("style"); st.textContent = "#piper-note{grid-column:1/-1;margin:.4rem 0;padding:.4rem .6rem;border:1px solid #888;border-radius:6px;font-size:.9rem}#piper-note[hidden],#piper-note [hidden]{display:none!important}#piper-note progress{width:100%;display:block;margin:.3rem 0}#voice{text-overflow:ellipsis}#piper-note button{margin:.2rem .4rem .2rem 0;min-height:36px}"; document.head.appendChild(st);
      box = document.createElement("div"); box.id = "piper-note"; box.setAttribute("role", "status"); box.hidden = true;
      txt = document.createElement("span"); bar = document.createElement("progress"); bar.max = 100; bar.hidden = true;
      bDl = document.createElement("button"); bDl.textContent = "Download now"; bCx = document.createElement("button"); bCx.textContent = "Cancel"; bRm = document.createElement("button"); bRm.textContent = "Remove downloaded voice";
      box.appendChild(txt); box.appendChild(bar); box.appendChild(bDl); box.appendChild(bCx); box.appendChild(bRm); bRm.onclick = function () { var v = piperVoice(); if (v) removeStored(v); };
      var anchor = document.getElementById("voice-notice") || sel.parentNode; anchor.parentNode.insertBefore(box, anchor.nextSibling);
      bDl.onclick = function () { var v = piperVoice(); if (!v) return; startLoad(v); };
      bCx.onclick = function () { cancel(); };
      sel.addEventListener("change", onChange); sel.addEventListener("change", function () { var o = opt(); sel.title = o ? o.textContent : ""; });
      lastSys = null; var o0 = opt(); if (o0 && !isPiper() && /, local\)$/.test(o0.textContent)) lastSys = sel.value;
    }
    function opt() { return sel && sel.options[sel.selectedIndex]; }
    function isPiper() { var o = opt(); return !!(o && /^Piper /.test(o.textContent)); }
    function piperVoice() { var o = opt(); if (!o || !/^Piper /.test(o.textContent)) return null; var n = /Alba/.test(o.textContent) ? 0 : 1; return PV[n]; }
    function show(m, o) { box.hidden = false; txt.textContent = m; bar.hidden = !(o && o.bar); bDl.hidden = !(o && o.dl); bCx.hidden = !(o && o.cx); bRm.hidden = !(o && o.rm); }
    function opfs() { return navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle("piper", { create: true }); }); }
    function storedSize(id) { return opfs().then(function (d) { return d.getFileHandle(id + ".onnx").then(function (h) { return h.getFile(); }).then(function (f) { return f.size; }); }).catch(function () { return 0; }); }
    function fileSize(d, n) { return d.getFileHandle(n).then(function (h) { return h.getFile(); }).then(function (f) { return f.size; }).catch(function () { return -1; }); }
    function storedOk(id) { var e = EXPECT[id]; if (!e) return Promise.resolve(false); return opfs().then(function (d) { return Promise.all([fileSize(d, id + ".onnx"), fileSize(d, id + ".onnx.json")]); }).then(function (z) { return z[0] === e[0] && z[1] === e[1]; }).catch(function () { return false; }); }
    function notStored(v) { if (!box) init(); if (!box) return; disposeAll(); state = "idle"; show(v.name + " is not downloaded (or the browser removed it). Nothing was fetched. Press Download now to download it again (about 63 MB), or choose another voice.", { dl: true, cx: true }); }
    function removeStored(v) { killWork(); return opfs().then(function (d) { return Promise.all([id1(d, v.piperId + ".onnx"), id1(d, v.piperId + ".onnx.json")]); }).then(function () { state = "idle"; show(v.name + " removed from this extension's browser storage.", { dl: true, cx: true }); P.removed = true; }, function (e) { show("Could not remove the stored voice (" + (e && e.message || e) + ").", {}); }); }
    function id1(d, n) { return d.removeEntry(n).catch(function () {}); }
    var prog = false;
    function setSel(v) { prog = true; try { sel.value = v; sel.dispatchEvent(new Event("change")); } finally { prog = false; } }
    function revert() { if (lastSys != null) { if (sel.value !== lastSys) setSel(lastSys); return "restored"; } if (!sel.querySelector('option[value=""]')) { var ph = document.createElement("option"); ph.value = ""; ph.textContent = "Choose a voice"; sel.insertBefore(ph, sel.firstChild); } setSel(""); return "none"; }
    function after(r) { return r === "restored" ? "Switched back to " + sysName() + ". Press Play to continue." : "Pick a voice to continue."; }
    function sysName() { var o = sel.options[sel.selectedIndex]; return o ? o.textContent.replace(/ \([a-z]{2,3}(-[A-Za-z0-9-]+)?, (local|online)\)$/i, "") : "the system voice"; }
    function onChange() {
      if (!isPiper()) { if (!prog && sel.value !== "") lastSys = sel.value; state = "none"; box.hidden = true; if (!busy()) disposeAll(); return; }
      var v = piperVoice(); curName = v.name;
      if (loadedIds[v.piperId]) { state = "ready"; show(v.name + " is loaded.", { rm: true }); return; }
      state = "idle"; show(v.name + ": about 63 MB, downloaded from huggingface.co, then kept in this extension's browser storage so it may not need downloading again. You can remove it here; the browser can also clear it. " + v.credit, { dl: true, cx: true });
      storedSize(v.piperId).then(function (n) { if (n && state === "idle" && isPiper()) show(v.name + " is stored in this extension's browser storage (" + mb(n) + " MB).", { dl: false, cx: true, rm: true }), P.storedMB = mb(n); });
    }
    function startLoad(v) {
      allow[v.piperId] = 1; state = "loading"; show("Downloading " + v.name + "...", { bar: true, cx: true }); bar.removeAttribute("value");
      return wload(v.piperId).then(function () { loadedIds[v.piperId] = true; if (state === "loading") { state = "ready"; show(v.name + " is loaded.", { rm: true }); } }, function (e) { if (e && e.message === "stale") return; fail("Could not download " + v.name + " (" + (e && e.message || e) + ")."); }).then(function () { delete allow[v.piperId]; });
    }
    function progress(p) { if (!box) init(); if (!box) return; if (state !== "loading") { state = "loading"; show("Downloading " + curName + "...", { bar: true, cx: true }); }
      if (p.total) { bar.max = p.total; bar.value = p.loaded; txt.textContent = "Downloading " + curName + "... " + mb(p.loaded) + " of " + mb(p.total) + " MB"; P.dl = { loaded: p.loaded, total: p.total }; } else { txt.textContent = "Downloading " + curName + "... " + mb(p.loaded) + " MB"; } }
    function ready() { if (box && state === "loading") { state = "ready"; var v = piperVoice(); if (v) loadedIds[v.piperId] = true; show(curName + " is loaded.", { rm: true }); } }
    function fail(m) { m = String(m).replace(/[.\s]+$/, ""); if (!box) init(); disposeAll(); state = "error"; var r = revert(); show(m + ". " + after(r), {}); P.lastFail = m; }
    function cancel() { var was = state; killWork(); state = "cancelled"; var r = revert(); show((was === "loading" ? "Download cancelled. " : "Piper not used. ") + after(r), {}); }
    function killWork() { allow = {}; okIds = {}; if (worker) { worker.terminate(); worker = null; } var w = wcb; wcb = {}; Object.keys(w).forEach(function (k) { w[k].rej(new Error("stale")); }); killPending(); loadedIds = {}; }
    function disposeAll() { killWork(); }
    function busy() { return !!cur || running || waiting.length; }
    document.addEventListener("DOMContentLoaded", init); setTimeout(init, 500); setTimeout(function () { init(); if (sel && isPiper()) onChange(); }, 1500);
    return { stored: storedOk, notStored: notStored, progress: progress, ready: ready, fail: fail, cancel: cancel, init: init, disposeIfPiperUnused: function () { if (worker) disposeAll(); }, setName: function (n) { curName = n; } };
  })();

  function wpredict(id, text, loadOnly) {
    if (!worker) { worker = new Worker(ROOT + "worker.js"); worker.onmessage = function (e) { lastMsg = Date.now(); var m = e.data; if (m.ready) return; if (m.prog) { UI.progress(m.prog); return; } var cb = wcb[m.id]; delete wcb[m.id]; if (!cb) return; if (m.error) cb.rej(new Error(m.error)); else if (m.loaded) { P.loadInfo = { ms: m.ms, res: m.res }; cb.res(true); } else { P.pf.workerMs = m.ms; cb.res(new Blob([m.ab], { type: "audio/wav" })); } }; worker.onerror = function (e) { P.workerError = String(e.message || e); var w = wcb; wcb = {}; Object.keys(w).forEach(function (k) { w[k].rej(new Error("worker error: " + (e.message || "unknown"))); }); UI.fail("The Piper worker stopped (" + (e.message || "unknown error") + ")."); }; }
    return new Promise(function (res, rej) { var k = ++wid; wcb[k] = { res: res, rej: rej }; lastMsg = Date.now(); var lim = (loadOnly ? 30000 : 30000 + 120 * String(text || "").length), t = setInterval(function () { if (!wcb[k]) { clearInterval(t); return; } if (Date.now() - lastMsg > lim) { clearInterval(t); var c = wcb[k]; delete wcb[k]; c.rej(new Error(loadOnly ? "the download stopped, no data received" : "the voice engine stopped responding")); } }, 250); worker.postMessage({ id: k, voiceId: id, text: text, type: loadOnly ? "load" : "predict" }); }).then(function (r) { if (loadOnly) return r; UI.ready(); return r; });
  }
  function wload(id) { return wpredict(id, "", true); }
  /* Latest-wins scheduler: at most one running synthesis plus the jobs still wanted (speak + one prefetch). Cancel drops every waiting job at once. */
  var waiting = [], running = false;
  function pump() {
    if (running || !waiting.length) return;
    var idx = waiting.findIndex(function (j) { return !j.prefetch; }); if (idx < 0) idx = 0;
    var job = waiting.splice(idx, 1)[0]; running = true; P.pf.ran = (P.pf.ran || 0) + 1;
    gateId(job.id).then(function () { return wpredict(job.id, job.text); }).then(function (r) { okIds[job.id] = 1; return r; }).then(job.res, function (e) { delete okIds[job.id]; job.rej(e); }).then(function () { running = false; pump(); }, function () { running = false; pump(); });
  }
  function run(id, text, isPrefetch) {
    return new Promise(function (res, rej) {
      if (isPrefetch) waiting = waiting.filter(function (j) { if (j.prefetch) { j.rej(new Error("stale")); P.pf.dropped = (P.pf.dropped || 0) + 1; return false; } return true; });
      waiting.push({ id: id, text: text, prefetch: !!isPrefetch, res: res, rej: rej });
      P.pf.maxWaiting = Math.max(P.pf.maxWaiting || 0, waiting.length); pump();
    });
  }
  function killPending() { var w = waiting; waiting = []; w.forEach(function (j) { j.rej(new Error("stale")); }); P.pf.skipped = (P.pf.skipped || 0) + w.length; }
  var piperDispose = function () { if (worker) { worker.terminate(); worker = null; } sessions = {}; cache = null; killPending(); if (ctx) { ctx.close(); ctx = null; } };
  function prefetch(text, voice) { if (!voice || !voice.piperId) return; var key = voice.piperId + "|" + text; if (cache && cache.key === key) return; P.pf.started++; var mine = { key: key, p: run(voice.piperId, text, true) }; cache = mine; mine.p.then(function () { if (cache !== mine) P.pf.discarded++; }, function () {}); }
  /* Never download implicitly: speaking needs the model already stored with the expected sizes, unless the user's Download now is running. */
  function gateId(id) { if (allow[id] || okIds[id]) return Promise.resolve(); return UI.stored(id).then(function (ok) { if (!ok) { var v = PV.filter(function (x) { return x.piperId === id; })[0]; if (v) UI.notStored(v); throw new Error("notstored"); } }); }
  function gate(v) { return gateId(v.piperId); }
  var synth = {
    getVoices: function () { return native.getVoices().concat(PV); },
    speak: function (u) {
      if (!u.voice || !u.voice.piperId) { UI.disposeIfPiperUnused(); return native.speak(toNative(u)); } UI.setName(u.voice.name);
      var my = ++gen; cur = { u: u, my: my, src: null }; var t0 = performance.now(); ev("speak", u.text.slice(0, 30) + "|r=" + u.rate);
      gate(u.voice).then(function () { return getWav(u.voice.piperId, u.text); }).then(function (wav) {
        if (my !== gen) return; 
        return wav.arrayBuffer().then(function (ab) { ctx = ctx || new AudioContext(); return ctx.decodeAudioData(ab); }).then(function (buf) {
          if (my !== gen) return; var src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = u.rate || 1; src.connect(ctx.destination); cur.src = src;
          P.lastDur = buf.duration; src.onended = function () { if (my !== gen || paused) return; ev("end"); cur = null; if (u.onend) u.onend({}); };
          var go = ctx.state === "suspended" && !paused ? ctx.resume() : Promise.resolve(); P.ctxAtStart = ctx.state; if (paused) { ctx.suspend(); } src.start(); ev("start", { dur: buf.duration }); if (u.onstart) u.onstart({});
        });
      }).catch(function (e) { if (e && e.message === "notstored") { if (u.onerror) u.onerror({ error: "piper-failed" }); return; } if (e && e.message === "stale") return; UI.fail("Piper stopped: " + String(e && e.message || e).slice(0, 80) + "."); ev("error", String(e && e.message || e)); if (u.onerror) u.onerror({ error: "piper-failed" }); });
    },
    prefetch: prefetch,
    piperStored: function (v) { return v && v.piperId ? UI.stored(v.piperId) : Promise.resolve(false); },
    cancel: function () { native.cancel(); cache = null; killPending(); gen++; if (cur && cur.src) { try { cur.src.onended = null; cur.src.stop(); } catch (e) {} } cur = null; paused = false; if (ctx && ctx.state === "suspended") ctx.resume(); ev("cancel"); },
    pause: function () { native.pause(); if (cur) { paused = true; if (ctx) ctx.suspend(); ev("pause"); } },
    resume: function () { native.resume(); if (paused) { paused = false; if (ctx) ctx.resume(); ev("resume"); } },
    get speaking() { return !!cur || native.speaking; }, get pending() { return native.pending; }, get paused() { return paused || native.paused; },
    addEventListener: function () { return native.addEventListener.apply(native, arguments); }, removeEventListener: function () { return native.removeEventListener.apply(native, arguments); }
  };
  Object.defineProperty(synth, "onvoiceschanged", { get: function () { return native.onvoiceschanged; }, set: function (f) { native.onvoiceschanged = f; } });
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
  window.SpeechSynthesisUtterance = Utter;
})();

