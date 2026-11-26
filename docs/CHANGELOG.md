## 1.0.28 (2026-11-26) - Firefox local-file message

- Fix: in Firefox, the popup on a local file:// tab no longer suggests the Chromium "Allow access to file URLs" setting. It says: "This page can't read local files in Firefox. Open the file in the PDF / text reader above instead." Chromium and Brave keep the file-access message. Both now point to the reader button above the message (it said "below").
- Tests: firefox-msgflow with MSGFLOW_FILE opens a real file:// tab through WebDriver and clicks the real popup button; PASS on Firefox 153.8 ESR and 140.8 ESR.
- Test environment correction: test/firefox-msgflow.js used the system Firefox ESR 140.8 until this version; it now defaults to the 153.8 ESR binary (like the other Firefox tests). Earlier CHANGELOG lines that say the message-flow suite passed on "ESR 153.8" refer to runs whose binary was not recorded and may have been 140.8. Real versions: ~/browsers firefox-esr 153.8.0esr, system firefox-esr 140.8.0esr.
- Limit: local file tabs in Firefox remain unsupported (the extension cannot inject into them on 153.8).

## 1.0.27 (2026-11-26) - Closed details are not read

- Text inside a closed expandable section (the HTML details element) is no longer read: only its summary line is read until the section is opened. This applies to web pages and to uploaded HTML files. An open section is read in full. Text scrolled out of view is still read. User-approved ("reading only what is shown").
- Tests: new test/details-upload-e2e.js, adversarial extract cases for closed, nested and open details (Chromium and Firefox).

## 1.0.26 (2026-11-26) - Collapsible player

- The whole player box can be collapsed with an arrow at the end of the transport row (up when expanded, down when collapsed). Collapsed shows only Back, Play, Pause, Forward and the arrow. Playback and Settings state are kept. The collapsed state is per view and is not saved.
- Fix: the Cancel text recognition button no longer stays visible after a scan load is replaced by another file. It shows only during scan recognition.
- Tests: collapse-player-e2e (Chromium 1280/390/320, mock speech), cancel-load-e2e.

## 1.0.25 (2026-11-26) - Slim upload strip

- Reader: the file box is now a slim one-line strip directly under the title (about 35px on desktop, 32px at 320 and 390px), with the explanation text below it. At 480px and narrower the label shortens to "Drop a file here". Choosing a file or dropping one works as before; a very long file name keeps the strip on one line and the Choose File button visible. The status line under the player shows a shortened name (about 20 characters, middle cut, extension kept) so the sticky player no longer grows to about 8 lines with a 100-character name; the full name is in the status tooltip and the file chooser.
- Tests: new upload-strip test (mock speech, 1280/390/320px, Settings open and closed): strip height at most 40px before and after loading, no horizontal overflow, compact status (at most 4 lines at 320px) with the full name in the tooltip, sticky player at most 40% (46% with Settings open) of the viewport, active sentence clear of the player. Scroll-sticky, read-from-here and Firefox layout tests pass.
- Limits: mock speech only, no audible-voice check, no physical phone check, Firefox native toolbar click not tested. At 320px the browser's own "No file chosen" text shortens to the end of the name; Choose File stays visible.

## 1.0.24 (2026-11-26) - Adversarial QA fixes

- Web pages: text drawn as a fallback inside canvas, object, embed, video and audio elements is no longer read; the visible text around them still is.
- Uploaded HTML files: the summary line of a details block is read as its own sentence instead of running into the text after it.
- Pages and files: control characters and the broken-text replacement character are removed before reading, so damaged or binary-looking text no longer produces stray sounds. Arabic marks, combining accents, emoji sequences, zero-width joiners and tabs/newlines are kept.
- Website bar: when switching language falls back to an online voice, the privacy notice is now shown before the first sentence is spoken with that voice (before, it appeared just after).
- Tests: new adversarial structure test (24 cases: nested boxes up to 400 deep, mixed layouts, malformed markup, a 2000-paragraph page, media fallbacks, details) in Chromium and Firefox (inert extraction, no audio); website bar test adds a nested-box page, rapid language/pause toggling and a notice-before-speech check for the online voice (mock speech); tab selection in two tests now picks the exact page. Unit tests 104.
- Known issue, unchanged: the body of a closed details block is still read, in pages and in uploaded files. Text positioned off-screen is also read (screen-reader-only pattern).
- Limits: mock speech only, no audible-voice check, no physical phone check, Firefox native toolbar click not tested.

## 1.0.23 (2026-11-26) - Responsive reader, website language selector

- Reader (PDF/text): cleaner layout with a sticky player, progress bar, A- / A+ text size (per view, not saved), automatic dark mode, higher text contrast, and an icon-only transport row on narrow screens (Settings toggle moves to the status row). Active sentence scrolls into view below the sticky bar.
- Popup: sectioned layout. The language default is English (United States); "Detect from the text" is still available.
- Web pages: the floating bar now has a visible language selector (English, Arabic Morocco, French). English is the default for reading from the toolbar and for right-click "Read from here". Switching language continues from the current sentence.
- Online voices: when you pick a language on the bar and the browser lists only online voices for it (Firefox reports all its speech voices as online), the first voice of that exact language is used and a notice says spoken text is sent to the browser's or system's voice provider. A voice of another language is never used; if no voice of that language exists the change is refused with a notice. No new permissions.
- The bar fits phone-width screens (wraps, 8px margin) and the page gets temporary bottom padding while it is shown, removed on Stop.
- Tests: new layout, scroll-sticky and website-bar tests (Chromium, mock speech) and Firefox layout and website-bar tests (real espeak-ng, dispatch assertions only). PDF robustness tests now use genuine invalid, blank, encrypted and truncated fixtures and fail if a fixture is missing.
- Limits: no audible-voice check and no physical phone check; Firefox headless cannot go below 500px wide (390/320px checked in Chromium only); Firefox native toolbar click not tested; website auto-follow scrolling not included; Arabic (Morocco) has no matching voice in the test Firefox.

## 1.0.22 (2026-11-26) - Page-reading fixes, right-click highlight

- Web pages: text directly inside div, section and table cells is read, once and
  in page order, also on pages with paragraphs. Without an article container the
  page is read block by block, skipping nav, sidebars and footers. Hidden text is
  not read, including on a page that has only hidden text.
- Class filter matches whole class tokens, not parts of words. If class filtering
  would remove most of a page with no article/main, it is turned off for that
  read. Uploaded HTML files drop class-marked boilerplate outside a real
  article/main (a block with 60% or more of the text is never dropped).
- A header inside an article (title, byline) and figure captions are read; site
  headers, navigation and share bars are still skipped.
- Open shadow roots (web components) are read only when the normal page has under
  200 characters of text, in page order. No highlight on that text.
- Right-click inside an embedded frame reads nothing and shows a note.
- Reader: after a right-click start, the highlight begins at the clicked word.
- Tests: div-text, shadow-dom, shadow-speech (mock speech), frameset, file:// and
  clear-data tests are new; e2e tests are standalone scripts (node test/<name>.js).
- Limits: Firefox local file tabs unsupported; native menu click not tested;
  OCR accuracy on synthetic degraded scans CER 16.75% / WER 47.59% (no real-scan
  data); the intermittent Firefox rejection on scan cancel is mitigated, not fixed.

## 1.0.21 (2026-11-26) - Right-click "Read from here"

- Right-click a word and choose "Read from here (ReadAloud)": reading starts at
  that word and continues to the end of the page text. A click inside a word
  starts at that word's first letter. Selection is ignored for this action and
  the saved resume position is skipped.
- Web pages: reads the article text of the page from the clicked word on. A click
  outside it (menus, sidebars), text drawn on a canvas, other sites' frames and
  the browser's built-in PDF viewer are not read; the page shows a short note
  instead of starting somewhere else. If the clicked text has changed or no
  right-click was recorded, nothing is read and the page says so.
- Reader page (PDF, HTML and text files): right-click a word in the text to start
  at that word and read to the last sentence. A normal click on a sentence still
  starts it whole.
- New permissions: contextMenus (the menu item) and access to all websites
  (top frame only) for a small script that remembers the position of the last
  right-click. It reads no page text, stores nothing and sends nothing.
- Language for this action is detected from the text (same detector as before).
- Checked: real right-click and the menu handler's entry point (not a physical
  menu click) in Chromium, Brave and Firefox ESR 153.8; reader page in all three.

## 1.0.20 (2026-11-25) - Language control in the toolbar popup

- The popup now has a Language control (Detect from the text, English (United
  States), Arabic (Morocco), French (France)) used by "Read this page" and "Read
  selected text". With "Detect from the text" the language comes from the text
  being read (same detector as the reader; Arabic needs a majority of Arabic
  letters), at the moment reading starts, never during speech. A language chosen
  by hand is always used. Voices match the region exactly; with no matching voice
  nothing is read, no other voice is used, and the popup names the language and
  lists the installed voice languages. A voice picked in the reader is used only
  if it speaks the language being read. The choice is not stored. Callers that
  send no language keep English (United States).
- Checked with message-protocol tests in Chromium and Brave and the real popup
  (in an iframe, not a physical toolbar click) in Firefox ESR 153.8.

## 1.0.19 (2026-11-25) - Repeated sentences fix, detected document language, French recognition

- Reported problem: sentences repeated during playback of an uploaded PDF.
  Cause: the reader refreshes the voice list while a file loads and whenever the
  browser reports a changed list, and each refresh re-applied the same voice,
  which restarted the sentence being read. Unchanged voice, speed and pitch now
  do nothing; a real change still applies. Checked with a playback-queue test
  (utterances equal sentences) in Chromium, Brave and Firefox. Before the fix:
  61 utterances for 60 sentences (Chromium), 10 for 5 (Firefox).
- Language control now offers English (United States), English (all regions),
  Arabic (Morocco) and French (France). Voices match the region exactly: a voice
  tagged only "fr" or "ar-SA" is not used for French (France) or Arabic
  (Morocco). With no matching voice the page says so, lists the installed voice
  languages, pauses, and uses no other voice.
- When a file is loaded (text, HTML, PDF, or recognised text of a scan) the
  language is chosen from its text: English, Arabic (needs a majority of Arabic
  letters) or French. It happens only at load, never during speech, and never
  replaces a language the user picked by hand. A note names the detected
  language. The toolbar popup (page and selected-text reading) has no language
  control yet and keeps English (United States) or the voice picked in the reader.
- Scanned-page recognition adds French data (packaged locally, no network).
  Synthetic degraded English benchmark: error rates unchanged (CER 16.75% vs
  17.40%), recognition about 19% slower (26.6 s vs 22.3 s, same session).

## 1.0.18 (2026-11-25) - Language control, online voices, recognition engine shutdown timing

- Reported problem: an English file was read with a French accent. Cause: the
  voice was the first installed local voice, whatever its language, and the
  utterance language was never set. Fix: the reader has a Language control next
  to Stop. English (United States) is the default; "English (all regions)" is
  the other choice; Arabic and French are listed as coming later. The voice
  list shows only voices of the chosen language. The program never picks a
  language from the document and never falls back to a voice of another
  language. With no voice for the chosen language, playback pauses with a
  message. The language choice is not stored.
- Online voices are listed automatically with local ones, labelled "online".
  The Allow/Disallow online voices buttons are removed. Selecting an online
  voice shows that spoken text is sent to the browser or system voice provider.
  The default pick is the first local voice in the language. If only online
  voices exist and the user has not chosen one, none is selected: the list shows
  "Choose a voice", Play (and page reading from the popup) is blocked with an
  explanation until the user picks one. A voice the user picked is kept.
- Connection loss: with an online voice in use, reading pauses and the page
  says so; on reconnect the voice list is refreshed (now, +1 s, +3 s) and
  nothing is restarted or switched. A chosen online voice missing from the
  list is not replaced: the list shows "Selected voice unavailable" and Play is
  blocked until it returns or another voice is chosen. A voice error keeps the
  position. Limits: the browser and OS decide which voices exist and how an
  online voice fails offline; the page cannot see the provider.
- Page reading from the popup: uses the voice picked in the reader, else
  English (United States) only; clear messages when none is available.
- Tests: voice-choice unit tests rewritten (8 cases, 99 total pass);
  test/voices-reconnect-chromium.js (simulated voices, real offline emulation);
  Firefox e2e checks the language list and real playback; popup flow test
  updated (stand-in voices, adapted transport).

- Cancel or a newer file now ends the scanned-page recognition engine 250 ms
  later instead of in the same instant, and the interface does not wait for it.
  Cost: a cancelled engine stays alive about 250 ms after Cancel (no new
  recognition starts in that time; one already running may finish).
- If Cancel or a newer file arrives while the engine is still starting, the
  engine is discarded when it finishes starting. Before, it stayed alive until
  the next load (found by code reading, then covered by test).
- Why: in a direct test in Firefox ESR 153.8, ending the engine in the first
  milliseconds of a recognition gave the unhandled rejection in 8 of 8
  attempts; 20 ms or later 0 of 2; after a 250 ms delay 0 of 6.
- Status: this is a mitigation. Absence of the console rejection in later runs
  is not proof the race is eliminated. See PROJECT_STATUS for run counts.
- New test: test/ff-cancel-resources.js (engine create/end/recognise counters).

## 1.0.17 (2026-11-25) - Scanned-page sentence boundaries; cancel guard

- On a scanned page, an Arabic line without final punctuation followed by an
  English line (or the reverse) is now two sentences instead of one. Lines
  with punctuation, wrapped lines in one script and mixed-script lines are
  unchanged.
- Scanned-page recognition checks for Cancel or a newer file before each of its
  internal recognition steps, and a superseded load no longer shuts down the
  recognition engine that a newer load is using.
- Known open issue: in Firefox ESR 153.8, cancel and replacement races on
  scanned files sometimes log one unhandled promise rejection from the bundled
  recognition engine ("postMessage ... is null") to the page console. It also
  occurs in v1.0.15. All functional checks still pass in those runs. Source
  located inside the engine's job chain; not fixed. Chromium and Brave: none seen.
- New tests: test/firefox-robustness.js (Firefox, document-state checks),
  test/firefox-ocr-measure.js, test/stress-scans-e2e.js.

## 1.0.16 (2026-11-25) - Scanned-page layout: columns and sideways pages

- Scanned pages with two or more text columns are now recognised column by
  column, so lines of neighbouring columns are no longer read across. Right to
  left pages read their columns from the right. Pages whose layout is unclear
  (for example a heading spanning the columns) are read as before.
- A page scanned sideways or upside down is detected when its recognised text
  does not look like words; the other orientations are tried and one is kept
  only if clearly more word-like. Normal pages are not retried.
- New test/stress-scans-e2e.js with a SYNTHETIC fixture (generated images, not
  real scans). Known limits: an Arabic line without final punctuation can merge
  with the next English line into one sentence, and the recognition engine can
  misread single letters (for example a hamza).

## 1.0.15 (2026-11-25) - Sentence splitting fixes (Arabic titles, lowercase continuations)

- Arabic titles "د." and "أ.د." no longer end a sentence when an Arabic name
  follows them.
- The fallback splitter (used only when Intl.Segmenter is missing) no longer
  splits before a lowercase letter. "fig" was added to the protected French
  abbreviations.
- test/segmenter.test.js now has 49 tests (synthetic corpus, Segmenter and
  fallback); the five-file npm test total is 98 of 98. Known ambiguous cases left alone: "etc." before a capital letter
  and "av. J.-C." before a capitalised word.

## 1.0.14 (2026-11-25) - Sentence splitting with Intl.Segmenter; PDF memory release

- Sentence splitting now uses Intl.Segmenter (sentence granularity) when the
  browser has it, with the locale chosen per paragraph in the order Arabic,
  French, English. Common English and French abbreviations, decimals and name
  initials are still protected, a lone closing quote or guillemet stays with
  its sentence, and paragraph breaks stay hard boundaries. Without
  Intl.Segmenter the previous regex splitter runs with the same protections.
  Both page reading and the reader use it.
- PDF documents are now released after text extraction (the parsed document
  was never destroyed before). Brave 1.78.102, 5 repeated loads of an 8-page
  synthetic scan: whole-browser memory after each load rose 1117, 1146, 1177,
  1212, 1216 MB before the change and stayed 1080, 1078, 1089, 1101, 1080 MB
  after it (one run each; Chromium swings by 100+ MB between loads, so no
  change is claimed there).
- Tests: unit suites now five files, 60 tests (new test/segmenter.test.js runs
  French, Arabic and mixed fixtures on both the Segmenter and fallback paths);
  in-browser English/French/Arabic splitting checks on Chromium, Brave and
  Firefox ESR; all earlier e2e suites re-run on the final code.

## 1.0.13 (2026-11-25) - Local text recognition (OCR) for scanned PDFs

- PDF pages that have no text layer are now recognised on the device, so
  scanned English and Arabic PDFs can be read aloud. Pages that do have a
  text layer keep the existing extraction; a PDF with both kinds of page uses
  each method per page. A "Cancel text recognition" button appears while a
  scanned page is being processed.
- Added packaged files under vendor/tesseract: tesseract.js 5.1.1 and
  tesseract.js-core 5.1.1 (both Apache-2.0) and English + Arabic "best"
  language data, 4.0.0 (@tesseract.js-data, wrapper MIT; models Apache-2.0).
  License files ship with them. Nothing is downloaded at run time and no page
  image or text leaves the device.
- Manifest: added an extension-pages content security policy,
  `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. The only
  relaxation is permission to compile the packaged WebAssembly; remote
  scripts are still blocked. Permissions are unchanged (activeTab, scripting,
  storage); no host access.
- Replacing a file (or cancelling) while recognition is running stops the
  recognition and discards its output; the old file can no longer overwrite
  the new one. The recognition worker is shut down after each load, on cancel
  and on error.
- Tests (test/ocr-e2e.js, plus a block in the Firefox ESR e2e): scanned
  English, scanned Arabic, mixed text+scanned PDF, replacement race, cancel
  and cleanup. The Chromium and Brave run also separates packaged-resource
  loads (worker, WASM, English and Arabic data) from external requests: 0
  external requests, with the browser unable to resolve any external host.
  Scanned fixtures are rendered from text, not photographs: results show the
  engine on clean, large type, not accuracy on real scans.

- Added after publication (tests only, runtime files unchanged): Firefox ESR
  now also plays recognised English text to the end through the real speech
  stack; the unmodified-popup message test was re-run on v1.0.13 (Firefox ESR
  153.8 and Developer Edition 162.0b1, PASS); test/ocr-accuracy.js measures
  error rate, time and browser memory on two synthetic 8-page degraded
  fixtures (not real scans). Mild: 5.8% character / 17.5% word error in both
  Chromium and Brave 178; severe: 17.4% / 48.2%. About 2.4-3.9 s per page.
  Browser memory rose about 190-250 MB at peak; it returned to the starting
  level in Chromium but stayed about 170 MB above it in Brave 1.5 s after
  loading finished. Render scale matters (mild fixture: 1.5x 3.2%, 2x 5.8%,
  3x 11.1% character error); it was left at 2x.

## 1.0.12 (2026-11-25) - HTML file upload in the reader

- The reader now opens .html/.htm files. The file is parsed locally with
  DOMParser into an inert document (no script runs, no image, stylesheet,
  frame or other sub-resource is fetched, no markup is inserted into the
  reader); only text is taken. Navigation, headers/footers, forms, hidden
  elements, scripts, styles, SVG and embedded objects are excluded, and the
  main/article region is preferred when present. No new permissions, no
  new dependencies, no network.
- Starting to load any file now drops the previous document first, so Play
  pressed while a new file is still loading can no longer replay the old one.
- `npm test` now runs all four unit suites (49 tests); previously the script
  listed only two files (31 tests).
- Tests: Chromium and Brave e2e and Firefox ESR e2e load a markup fixture
  containing scripts, event handlers, remote image/stylesheet/iframe/object
  references, a meta refresh, hidden text and a javascript: link. Readable-text
  checks and the separate inertness checks (0 requests to a local counting
  server, no script ran, no markup inserted) both pass; Firefox also starts
  real-voice playback of the parsed text.

## 1.0.11 (2026-11-25) - Firefox production message transport fix

- The popup now installs a small message dispatcher from a function-injected
  script before injecting the reader files. Firefox (ESR 153.8 and Developer
  Edition 162.0b1 in the test environment) does not deliver runtime messages
  to listeners registered by file-injected scripts - root cause unknown -
  while function-registered listeners do receive them. The dispatcher
  delegates to the same production handler, is idempotent (repeat clicks and
  reinjection after reload never stack listeners), and the reader's own
  listener defers to it, so every message is handled exactly once on every
  browser. No permission changes.
- The Firefox message-flow suite now drives the REAL popup unmodified (loaded
  in a test iframe, real button clicks) instead of a test-only message
  bridge: gate refusal, read after opt-in, reload + resume at the saved
  sentence, selection-only reading, and the speed slider all pass through the
  unmodified production path on both Firefox ESR 153.8 and Developer Edition
  162.0b1.
- scripts/check-package.sh: automated package-content check (rejects
  developer-only files and unlabeled developer commands in the runtime zip;
  manifest version must match the zip version).

# Changelog

## 1.0.10 (2026-11-25) - Cycle 7: fixes confirmed from the owner's independent audit of v1.0.7
- Reproduced and fixed (B15, medium): after a failed file load (empty/unreadable), the previous document's speech queue stayed alive - Play replayed the old document while the interface said the new file could not be read. Present in v1.0.7 through v1.0.9 (same code path). A failed load now clears the engine queue, rendered text and position key. Regression in the Chromium 160 / Brave 1.78.102 e2e (load PDF, fail a load, Play stays dead).
- Reproduced and fixed (B16, low): the speech watchdog interval was never disarmed on natural completion (only on stop/load/error), leaving an idle timer running. Present in v1.0.7 through v1.0.9. Natural completion now disarms it. Unit-tested with an armed watchdog (49 total).
- Fixed (B17, low): the README shipped in the runtime zip advertised npm test/lint commands that only exist in the full source tree; it now says those apply to the developer archive.
- The audit's other two items are not defects: HTML file upload was never in the requirements (F1-F11 cover web pages, selections, PDF and plain text) and scanned-PDF OCR was an explicitly declared limitation - both are now owner-requested additions, tracked for the next cycles.
- Verified: 49/49 unit; Chromium 160 e2e PASS; Brave 1.78.102 e2e PASS; Firefox ESR 153.8 e2e PASS (real audio); Firefox message-flow suite PASS on ESR 153.8 and Developer Edition 162.0b1.

## 1.0.9 (2026-11-25) - Cycle 6: protocol coverage + sentence-splitting fixes
- Coverage: the Firefox message-flow suite now also exercises READ_SELECTION (clean refusal with no selection; reads only the selected text - 1 of 5 page sentences) and SET_RATE (acknowledged; audible effect needs real speech, unavailable on web pages here), over the adapted transport on both Firefox ESR 153.8 and Developer Edition 162.0b1. All prior assertions unchanged.
- Fixed (B13): sentence splitting missed the boundary when a closing quote followed the period - "He said 'Stop.' She left." stayed one sentence. Splits now happen after sentence punctuation plus closing quotes. Parentheses are deliberately excluded: a period inside parens is usually mid-sentence.
- Fixed (B14): initials in names split wrongly - "He met J. R. Tolkien." became three sentences. A standalone capital + period before another capital is now protected. 3 new unit tests (48 total).
- Verified: 48/48 unit; Chromium 160 e2e PASS; Brave 1.78.102 e2e PASS; Firefox ESR 153.8 e2e PASS (real audio); Firefox message-flow suite PASS on ESR 153.8 and Developer Edition 162.0b1. All classification wording from 1.0.7/1.0.8 stands.

## 1.0.8 (2026-11-25) - Cycle 4: defect fixes from a full autonomous code review
- Fixed (B9): Space on a focused reader sentence sought AND immediately paused - the sentence's keydown handler and the page-level shortcut handler both acted on the same event (Enter was fine; the B8 test only covered Enter). The page-level handler now skips already-handled events. Regression asserted in the Chromium 160 / Brave 1.78.102 e2e (synchronous dispatch check) and in the Firefox ESR 153.8 e2e with real audio ("Sentence 3 of 5 - speaking").
- Fixed (B10): choosing "Browser default" after picking a voice did not persist - a null voiceURI was silently ignored, so the saved voice returned on reload. Settings saves now apply keys that are present (explicit clears included) and leave absent keys untouched, so popup rate-only saves still never wipe the voice or the opt-in. 3 new unit tests (45 total).
- Added (B11): the online-voice opt-in is now revocable - "Disallow online voices" appears while it is active; revoking hides online voices, clears a saved online voice, stops playback when no local fallback exists, re-blocks behind the same gate, and persists. Runtime-verified in the Firefox e2e: blocked -> opted in -> revoked -> blocked again -> re-opted in, real audio after.
- Fixed (B12): web-page reading no longer blips sentence 1 before jumping to a saved resume position; the position is looked up before playback starts.
- Second-engine checks from this cycle: the Firefox message-flow suite passes on both Firefox ESR 153.8 and Firefox Developer Edition 162.0b1, and the message-delivery failure (tabs.sendMessage to executeScript-injected listeners) reproduces identically on both - so this is a genuine transport compatibility risk, not attributable to this sandbox alone and not an ESR quirk. Whether the unmodified toolbar-button-to-page flow works on a desktop Firefox installation remains an open, unresolved check. Attempted real system speech for Chromium/Brave via speech-dispatcher (headless, headful/Xvfb, --enable-speech-dispatcher): 0 voices in every mode, so the simulated-callback qualification on B3 stands.
- Verified: 45/45 unit; Chromium 160 e2e PASS; Brave 1.78.102 e2e PASS (incl. B3 web-resume wiring with simulated speech callbacks over the unmodified transport); Firefox ESR 153.8 e2e PASS (real audio 5/5, revoke flow, Space regression, resume); Firefox message-flow suite PASS on ESR 153.8 and Developer Edition 162.0b1 (adapted transport - classifications from 1.0.7 unchanged).

## 1.0.7 (2026-11-25) - Cycle 3 part 5: Firefox popup path fix + opt-in status fix
- Fixed a real Firefox correctness bug in page reading: Firefox resolves scripting.executeScript file paths relative to the calling page, so the popup's relative injection paths failed there; paths are now root-absolute ("/shared/store.js" etc.) in popup/popup.js and the tests. Chromium-family behavior unchanged (re-verified after the change).
- Fixed a stale status: after "Allow online voices", the reader's paused-playback explanation (which points at the now-gone Allow button) is cleared. Regression asserted in the Firefox e2e: the blocked explanation must be gone right after opt-in.
- content/read-page.js: the message switch is now a named handler, also exposed as window.__readAloudMessage (invisible to pages, like the existing extraction hook). No behavior change.
- New Firefox message-flow test (test/firefox-msgflow.js): exercises the production message protocol and handlers (exact inject-file list, READ_PAGE / STATE / STOP) against a real localhost page in Firefox ESR 153.8. Verified: the voice gate blocks without opt-in ({ok:false, reason no-local-voice, onlineCount 2} against a controlled all-remote voice list, because this environment exposes 0 voices to web-page contexts), reading starts after opt-in (5 sentences), STATE reports speaking 1/5, STOP works, the web position save/load round-trips under the origin+path key (no query string), and a seeded-position reload/resume check: with a saved position seeded at sentence 3, a real page reload + re-injection, READ_PAGE resumes at that sentence. This is seeded-position coverage over the adapted transport; the full live-reading save/reload/resume loop (positions advanced by real speech events during reading) remains uncovered in this environment.
- Classification: this is production-handler/protocol coverage with an ADAPTED TRANSPORT, not end-to-end popup-flow verification. In this test environment Firefox does not deliver tabs.sendMessage to listeners registered by scripting.executeScript-injected scripts (7 routes tested: files, func, manifest-declared, eval async/sync, dynamic import; declared and direct-func listeners receive messages, async sendResponse works, injected-script listeners never do), so the harness substitutes that delivery hop with a func-registered dispatcher into the production handler. Cross-checked 2026-11-25 on a second engine generation: the same failure reproduces on Firefox Developer Edition 162.0b1 (files-injected listener probe hung; func and manifest-declared probes answered; the full adapted-transport suite passed there too), so this is not an ESR-153.8-specific quirk. With two engine generations failing identically, this is a genuine transport compatibility risk, not attributable to this sandbox alone; whether the unmodified toolbar-button-to-page flow works on a desktop Firefox installation is unresolved (the same flow passes unmodified in the Chromium 160 and Brave 1.78.102 e2e).
- Web-resume coverage added (test-only changes: e2e scenario B3 + timed mode in the mock-speech fixture): on Chromium 160 and Brave 1.78.102 the production save/reload/resume wiring is exercised over the UNMODIFIED popup transport - reading stops mid-page with a real saved position under the origin+path key (sentence 6 of 8), the page is really reloaded, and READ_PAGE resumes at the saved sentence. Qualification: positions were advanced by simulated speech callbacks (the mock-speech fixture), not audible speech - this is wiring coverage, not proof of real speech-event delivery. On Firefox, web resume is covered by the seeded-position reload check over the adapted transport (web contexts see 0 voices there).
- Verified: 42 unit tests; Chromium 160 e2e; Brave 1.78.102 e2e; Firefox ESR 153.8 e2e (incl. the new opt-in regression); Firefox message-flow suite PASS on both Firefox ESR 153.8 and Firefox Developer Edition 162.0b1.
- Validation note (2026-11-25, no code change): attempted to replace the Chromium/Brave simulated speech callbacks with real system speech - both binaries link libspeechd, but neither Chromium 160 nor Brave 1.78.102 enumerates any voice in this environment (headless, headful under Xvfb, and with --enable-speech-dispatcher, against a running speech-dispatcher + espeak-ng stack that Firefox uses successfully). The simulated-callback qualification on the B3 web-resume result therefore stands unchanged; audible speech-event delivery on Chromium/Brave remains a real-device check.

## 1.0.6 (2026-11-25) - Cycle 3 part 4: local storage + voice privacy
- Reading progress and settings, on this device only (user-approved scope): the reader resumes a PDF/text file where you stopped (keyed by file name+size), web-page reading resumes by page origin+path (query strings never stored), and voice/rate/pitch choices persist. Positions store a sentence index only, capped at 50 entries with 90-day expiry; new "Clear saved data" button in the popup wipes settings+positions. No document text is stored; chrome.storage.local only, no sync, nothing leaves the device. Adds the "storage" permission (local).
- Voice privacy: local-only is the enforced default, not a preference. The voice list labels every voice local/online; online voices are hidden until a deliberate "Allow online voices" choice, and without it playback pauses with an explanation instead of silently using a remote voice. The opt-in shows the disclosure that spoken text is sent to the voice provider. The ambiguous "browser default" entry is only offered after opting in, and a saved online voice can never bypass the gate. No remote speech services were added: the extension only ever uses the browser's own speechSynthesis voices.
- Verified: 42 unit tests (storage module, voice-choice gate, extraction, engine); Chromium 160 + Brave 1.78.102 e2e incl. settings persistence across reload and Clear-saved-data; Firefox ESR 153.8 runtime incl. playback blocked without opt-in, disclosed opt-in, full audio playback (5/5 sentences), position resume on re-upload (resumed at sentence 5 of 5), pitch/pause/resume/stop, hyphenation, chunking, content-script extraction.
- Environment note: this test environment's speech stack (espeak-ng via speech-dispatcher) exposes 8611 voices, all marked remote by Firefox (8611 unique names/URIs, verified; environment-specific, not desktop-representative). Chromium/Brave headless expose 0 voices. The local-available path is unit-tested (7 chooseVoice cases); the no-local case is additionally runtime-verified in Firefox.

## 1.0.5 (2026-11-25) - Cycle 3 part 3: discoverability + Firefox coverage
- Reader shows a shortcuts hint line and every control has a descriptive title (Space/arrows/Esc; click a sentence to read from it).
- Test enablement: content/read-page.js message-listener registration guarded + extraction exposed as window.__readAloudExtract (invisible to pages in the isolated content-script world). Real-Firefox content-script extraction now verified: article + complex-page fixtures pass in Firefox ESR 153.8 (extraction only; the message flow stays covered on Chromium/Brave). Web fixtures shared in test/fixtures/pages.js.
- Verified: 27 unit tests, Chromium 160 + Brave 1.78.102 e2e, Firefox ESR 153.8 runtime (reader path + content-script extraction).

## 1.0.4 (2026-11-25) - Cycle 3 part 2: shortcuts + follow-along highlight
- Reader keyboard shortcuts: Space toggles play/pause/resume, Left/Right move a sentence, Escape stops (ignored while a form control has focus). Stop now clears a sticky speech-error message.
- Follow-along highlight on web pages: the block containing the currently spoken sentence is outlined (block-level only, no DOM surgery; cleared on stop/end). Verified visually and in e2e on Chromium 160 + Brave 1.78.102; Firefox ESR 153.8 runtime PASS on the reader path.

## 1.0.3 (2026-11-25) - Cycle 3 part 1: RTL reliability + accessibility
- Reliability: RTL repair made conservative - mixed Latin/visual-Arabic lines are never reordered (pass through with a console.debug note); reversal now works at item level so multi-glyph items and Latin tokens ("PDF.") stay intact. Regression tests at unit and e2e level.
- B8: sentences in the reader are keyboard-operable (focusable, button role, Enter/Space seeks playback); on-page control bar has toolbar role and aria-live progress.
- Benchmark: 15-page/60-sentence PDF extracts and renders in ~150 ms. Verified: 27 unit tests, Chromium 160 + Brave 1.78.102 e2e, Firefox ESR 153.8 runtime. Docs: CYCLE-3-STORAGE-DESIGN (pending approval), RELEASE_PREP.

## 1.0.2 (2026-11-25) - Cycle 2: Extraction quality
- Fixed B6: multi-column PDF pages no longer interleave columns (RAText.splitColumns + per-column line rebuild). Verified on the tested two-column fixture; mixed full-width headings, uneven columns and RTL reading order remain coverage considerations.
- Article extraction upgraded to a Readability-class scorer: link-density penalty, semantic class/id weighting, boilerplate exclusion (nav, sidebar, footer, share/related/promo/comment blocks, hidden content). Blocks join as paragraphs so headlines no longer merge into the first sentence.
- New RAText.fixVisualOrderRtl: repairs visual-order Arabic presentation-form glyphs from browser print-to-PDF text layers (logical order + NFKC standard letters). LTR and already-logical RTL text untouched.
- New fixtures: sample-twocol.pdf (row-major two-column), sample-arabic.pdf (Chromium print-to-PDF), sample-multipage.pdf (15 pages, 60 sentences; generator in test/fixtures/build-fixtures.py). New complex-page e2e scenario proves article extraction with boilerplate excluded. Unit tests 21 -> 26. Verified: Chromium 160 e2e, Brave 1.78.102 e2e, real Firefox ESR runtime re-verification (PDF path, playback, pitch, chunking).


## 1.0.0 (2026-11-25)
First delivered build. Web page + selection reading, PDF/TXT reader with pdf.js v4, full playback controls, Arabic-aware splitting, floating control bar. Verified: 18 unit tests, Chromium/Brave e2e, real Firefox runtime with recorded speech, web-ext lint 0 errors. Known limits documented in REPORT.md.

## 1.0.1 (2026-11-25) - Cycle 1: Reliability
- Fixed B1: pitch slider now works and no longer clears the selected voice (engine.setPitch).
- Fixed B2: overlong sentences (>260 chars) are split into safe utterance chunks with highlight mapping preserved.
- Fixed B3: utterance watchdog restarts dropped utterances (bounded retries, speech-stalled error) and keeps long Chrome utterances alive.
- Fixed B4: popup reflects live playback state when reopened.
- Fixed B5: clear guidance for file:// tabs (file-URL access + built-in reader).
- Fixed B7: inline SVG control icons in reader and on-page control bar.
- Packaging: scripts/build.sh builds a versioned dist zip containing only runtime assets (no tests/docs/fixtures).
- Tests: 21 unit tests (3 new regression tests), Chromium 160 e2e, Brave 1.78.102 e2e, real Firefox ESR runtime with pitch + chunking instrumentation and recorded audio.
- Baseline 1.0.0 is retained as the labeled rollback build.

## Unreleased (audit cycle)
- Added docs/: audit, project status, requirements, architecture, roadmap, testing strategy, bug register, technical debt. No code changes.
