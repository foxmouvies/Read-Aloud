# ReadAloud: PDF & Text Reader

A browser extension for **Mozilla Firefox** and **Brave** (and other Chromium
browsers) that reads web pages, selected text, PDF files and plain-text files
aloud using your browser's built-in speech voices. Everything runs locally on
your machine. No account, no API key, no network calls.

## Features

- **Read this page** — one click reads the main article text of the page you are on.
- **Read selected text** — select any text, then read just the selection.
- **PDF reader** — open any `.pdf` in the extension's own reader tab (text is
  extracted locally with Mozilla's pdf.js, bundled inside the extension).
- **Plain-text reader** — open any `.txt` file the same way.
- **Full playback controls** — play, pause, resume, stop, previous/next sentence,
  reading speed, pitch and voice selection (in the reader tab).
- **Floating control bar** — appears on the web page while reading, so you can
  pause or stop even after the popup closes.
- **Click-to-read** — in the reader tab, click any sentence to start reading from it.
- **Sentence highlighting** — the sentence being read is highlighted; finished
  sentences are dimmed.
- **Arabic-aware** — sentence splitting understands Arabic punctuation (؟) in
  addition to English, and protects abbreviations ("Dr.") and decimals ("3.5").

## Install (Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select the `manifest.json` from this folder.
   (Temporary add-ons are removed when Firefox restarts. For a permanent install,
   the extension must be signed by Mozilla — see "What remains" in REPORT.md.)

## Install (Brave / Chromium)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

## Use

- Click the ReadAloud toolbar icon:
  - **Read this page** reads the article on the current tab.
  - **Read selected text** reads only what you selected on the page.
  - **Open PDF / text reader** opens the reader tab, where you can drop a
    `.pdf` or `.txt` file or pick one with the file chooser.
- While reading a page, use the floating bar (bottom-right) or the popup to
  pause, resume, stop, or change speed.

## How it works

- Speech: the Web Speech API (`speechSynthesis`) built into your browser and OS.
  Voices come from your operating system and browser; no audio leaves your machine
  for local voices. (Some browsers optionally offer network voices — those are
  labeled in the voice list and are provided by your browser vendor, not by us.)
- PDF text extraction: Mozilla's [pdf.js](https://github.com/mozilla/pdf.js) v4,
  bundled in `vendor/pdfjs/` so it works offline.

## Development

```
The commands below apply to the full source tree (the developer archive on the
download page), not to this runtime zip, which intentionally ships only the
files the browser loads - no package.json, tests or docs.

npm install        # dev dependencies (tests only; the extension itself needs nothing)
npm test           # unit tests (text processing + TTS engine)
npm run test:e2e   # end-to-end test in headless Chromium (see below)
npm run lint       # Mozilla web-ext validation for Firefox
```

The e2e test needs a Chromium binary. Either point `CHROME` in `test/e2e.test.js`
at one, or install one with `npx @puppeteer/browsers install chromium@latest`.
Note: recent Google Chrome (branded) ignores `--load-extension`; Chromium works.
