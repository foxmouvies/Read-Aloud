# Architecture

MV3 extension, no background worker. Three contexts share two pure UMD modules.

- shared/text.js: pure text processing (normalize, dehyphenate, sentence split, utterance chunking). No DOM. Unit-tested in Node.
- shared/tts-engine.js: evented sentence-queue state machine over speechSynthesis. No DOM.
- content/read-page.js: on-demand injected reader for web pages + floating control bar.
- reader/: extension page; bundled pdf.js v4 extracts PDF text (y-coordinate line rebuild); clickable sentence list.
- popup/: injects the content reader via chrome.scripting; relays controls.

## Decisions
- D1 Web Speech API over cloud TTS: free, offline-capable, no keys. Cost: voice quality/availability depends on the OS.
- D2 On-demand injection over persistent content scripts: minimal footprint and permissions.
- D3 Vendored pdf.js over CDN: offline, CSP-safe, pinned supply chain.
- D4 No backend: privacy and simplicity; persistence (Cycle 3) will use storage.local only.

## Invariants
Shared modules stay DOM-free. No new permission without owner consent. No network requests. Every defect fix ships with a regression test.
