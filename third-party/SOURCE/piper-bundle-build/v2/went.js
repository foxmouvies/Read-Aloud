/* ReadAloud Piper worker (own implementation).
 * Uses documented interfaces only:
 *  - Piper voice files: <voice>.onnx and <voice>.onnx.json from huggingface.co/rhasspy/piper-voices
 *  - piper-phonemize (built from source, see SOURCE/): main() takes --input JSON and prints JSON lines with "phoneme_ids"
 *  - ONNX Runtime Web: model inputs "input", "input_lengths", "scales" (and "sid" for multi-speaker voices)
 * Messages in:  {id, voiceId, type:"load"|"predict", text}
 * Messages out: {ready}, {prog:{loaded,total}, voiceId}, {id, loaded:true, ms}, {id, ab, ms}, {id, error}
 */
import './wpre.js';
import * as ort from 'onnxruntime-web/wasm';

var base = self.location.href.replace(/[^/]*$/, "");
var HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
var VOICES = {
  "en_GB-alba-medium": { path: "en/en_GB/alba/medium/en_GB-alba-medium", size: 63221984, jsonSize: 6295 },
  "fr_FR-siwis-medium": { path: "fr/fr_FR/siwis/medium/fr_FR-siwis-medium", size: 63221984, jsonSize: 6369 }
};
var sessions = {};

function voiceInfo(id) { var v = VOICES[id]; if (!v) throw new Error("unknown voice " + id); return v; }
function opfsDir() { return navigator.storage.getDirectory().then(function (r) { return r.getDirectoryHandle("piper", { create: true }); }); }
function readStored(dir, name, size) {
  return dir.getFileHandle(name).then(function (h) { return h.getFile(); }).then(function (f) {
    if (f.size !== size) return null; return f.arrayBuffer();
  }, function () { return null; });
}
function writeStored(dir, name, bytes) {
  return dir.getFileHandle(name, { create: true }).then(function (h) { return h.createSyncAccessHandle(); }).then(function (a) {
    try { a.truncate(0); a.write(bytes, { at: 0 }); a.flush(); } finally { a.close(); }
  });
}
function removeStored(dir, name) { return dir.removeEntry(name).catch(function () {}); }

/* Download with progress. The whole file is held in memory and written to storage only when complete,
 * so a cancelled or failed download never leaves a partial file behind. */
function download(url, expected, voiceId) {
  return fetch(url).then(function (r) {
    if (!r.ok) throw new Error("download failed (HTTP " + r.status + ")");
    var total = expected || +r.headers.get("content-length") || 0, loaded = 0, chunks = [], rd = r.body.getReader();
    function pump() {
      return rd.read().then(function (x) {
        if (x.done) return;
        chunks.push(x.value); loaded += x.value.length;
        self.postMessage({ prog: { loaded: loaded, total: total }, voiceId: voiceId });
        return pump();
      });
    }
    return pump().then(function () {
      if (expected && loaded !== expected) throw new Error("download incomplete (" + loaded + " of " + expected + " bytes)");
      var out = new Uint8Array(loaded), o = 0; chunks.forEach(function (c) { out.set(c, o); o += c.length; });
      return out;
    });
  });
}

function ensureFile(dir, name, url, size, voiceId) {
  return readStored(dir, name, size).then(function (b) {
    if (b) return new Uint8Array(b);
    return download(url, size, voiceId).then(function (bytes) { return writeStored(dir, name, bytes).then(function () { return bytes; }); });
  });
}

function loadVoice(id) {
  if (sessions[id]) return sessions[id];
  var v = voiceInfo(id), file = id + ".onnx", jfile = id + ".onnx.json";
  sessions[id] = opfsDir().then(function (dir) {
    return ensureFile(dir, jfile, HF + v.path + ".onnx.json", v.jsonSize, id).then(function (jb) {
      var cfg = JSON.parse(new TextDecoder().decode(jb));
      return ensureFile(dir, file, HF + v.path + ".onnx", v.size, id).then(function (mb) {
        ort.env.wasm.wasmPaths = base; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
        return ort.InferenceSession.create(mb, { executionProviders: ["wasm"] }).catch(function (e) {
          // A stored file that cannot be loaded is removed so the next try downloads it again.
          return removeStored(dir, file).then(function () { throw e; });
        });
      }).then(function (session) { return { cfg: cfg, session: session }; });
    });
  });
  sessions[id].catch(function () { delete sessions[id]; });
  return sessions[id];
}

/* Phonemize with the piper-phonemize WebAssembly build: returns the phoneme id list for the text. */
var glueLoaded = false;
function phonemeIds(text, espeakVoice) {
  if (!glueLoaded) { importScripts(base + "piper_phonemize.js"); glueLoaded = true; }
  var out = [], err = [];
  return self.createPiperPhonemize({
    print: function (t) { out.push(t); }, printErr: function (t) { err.push(t); },
    locateFile: function (f) { return base + f; }
  }).then(function (m) {
    var input = JSON.stringify([{ text: text }]);
    try { m.callMain(["-l", espeakVoice, "--input", input, "--espeak_data", "/espeak-ng-data"]); } catch (e) { if (!(e && e.name === "ExitStatus")) throw e; }
    var line = out.filter(function (l) { return l.charAt(0) === "{"; })[0];
    if (!line) throw new Error("phonemizer returned nothing" + (err.length ? ": " + err.join(" ").slice(0, 80) : ""));
    var ids = JSON.parse(line).phoneme_ids;
    if (!ids || !ids.length) throw new Error("no phonemes for this text");
    return ids;
  });
}

function wav16(samples, rate) {
  var peak = 0.01, i; for (i = 0; i < samples.length; i++) { var a = Math.abs(samples[i]); if (a > peak) peak = a; }
  var scale = 32767 / peak, n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
  function str(o, s) { for (var k = 0; k < s.length; k++) dv.setUint8(o + k, s.charCodeAt(k)); }
  str(0, "RIFF"); dv.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, "data"); dv.setUint32(40, n * 2, true);
  for (i = 0; i < n; i++) { var s = Math.round(samples[i] * scale); dv.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, s)), true); }
  return buf;
}

function predict(id, text) {
  return loadVoice(id).then(function (v) {
    var cfg = v.cfg;
    return phonemeIds(text, cfg.espeak.voice).then(function (ids) {
      var inf = cfg.inference || {};
      var feeds = {
        input: new ort.Tensor("int64", BigInt64Array.from(ids.map(function (x) { return BigInt(x); })), [1, ids.length]),
        input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale != null ? inf.noise_scale : 0.667, inf.length_scale != null ? inf.length_scale : 1, inf.noise_w != null ? inf.noise_w : 0.8]), [3])
      };
      if ((cfg.num_speakers || 1) > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
      return v.session.run(feeds).then(function (res) {
        var o = res[v.session.outputNames[0]];
        return wav16(o.data, cfg.audio.sample_rate);
      });
    });
  });
}

self.onmessage = function (e) {
  var m = e.data, t0 = performance.now();
  var job = m.type === "load" ? loadVoice(m.voiceId).then(function () { self.postMessage({ id: m.id, loaded: true, ms: Math.round(performance.now() - t0), res: [] }); })
    : predict(m.voiceId, m.text).then(function (ab) { self.postMessage({ id: m.id, ab: ab, ms: Math.round(performance.now() - t0) }, [ab]); });
  job.catch(function (err) { self.postMessage({ id: m.id, error: String(err && err.message || err) }); });
};
self.postMessage({ ready: true });
