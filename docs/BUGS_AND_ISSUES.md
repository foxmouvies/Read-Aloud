# Bugs and issues

Fixed in Cycle 7 (2026-11-25, from an independent audit of v1.0.7 supplied by the owner; each confirmed by code inspection against v1.0.7 and v1.0.9 before fixing (not dynamic reproduction); B15/B16 now carry automated runtime regressions, B17 an automated package-content check; shipped in v1.0.10):
- B15 (medium) Stale speech queue after a failed load: loading an empty/unreadable file after a good one left the old queue alive, so Play replayed the previous document while the UI said the new file could not be read. Fix: a failed load clears the engine queue, rendered text and position key. Regression: Chromium 160 + Brave 1.78.102 e2e.
- B16 (low) Speech watchdog never disarmed on natural completion (idle timer kept running). Fix: natural end disarms it. Unit-tested.
- B17 (low) README in the runtime zip advertised npm commands that exist only in the full source tree. Fix: README now points to the developer archive for those.
Audit items confirmed NOT defects: HTML file upload (never a requirement; now an owner-requested addition) and scanned-PDF OCR (declared limitation; now an owner-requested addition).

Fixed in Cycle 6 (2026-11-25, found by adversarial review of the sentence splitter; shipped in v1.0.9):
- B13 (medium) Sentence boundary missed after a closing quote ("He said 'Stop.' She left." stayed one sentence). Fix: split after sentence punctuation plus closing quotes; parentheses deliberately excluded (periods inside parens are usually mid-sentence). Unit-tested.
- B14 (medium) Initials in names split wrongly ("He met J. R. Tolkien." became three sentences). Fix: a standalone capital + period before another capital is protected. Unit-tested.

Fixed in Cycle 4 (2026-11-25, found by a full autonomous code review; shipped in v1.0.8):
- B9 (medium) Space on a focused reader sentence sought AND immediately paused: the sentence span's keydown handler and the page-level shortcut handler both acted on the same event (Enter was unaffected, and the existing B8 test only covered Enter). Fix: the page-level handler skips already-handled events (e.defaultPrevented). Verified: Chromium 160 + Brave 1.78.102 e2e regression (synchronous dispatch read) + Firefox ESR 153.8 e2e with real audio ("Sentence 3 of 5 - speaking").
- B10 (medium) "Browser default" voice choice did not persist: the settings merge silently ignored a null voiceURI, so the previously saved voice returned on reload. Fix: settings saves apply keys that are present (explicit null clears the saved voice; onlineOptIn false revokes) and leave absent keys untouched (popup rate-only saves still never wipe voice or opt-in). Verified: 3 new unit tests (45 total).
- B11 (medium) The online-voice opt-in could not be revoked: no UI, and the store could not record false. Fix: a "Disallow online voices" button while the opt-in is active; revoking hides online voices, clears a saved online voice, stops playback when no local fallback exists, re-blocks behind the gate, and persists (with the B10 store fix). Verified: Firefox ESR 153.8 e2e runs blocked -> opted in -> revoked -> blocked again -> re-opted in, with real audio after.
- B12 (low) Web-page reading blipped sentence 1 before jumping to a saved resume position. Fix: the saved position is looked up before playback starts. Verified: Chromium 160 + Brave 1.78.102 B3 web-resume scenario and the Firefox message-flow seeded reload/resume check stay green.

Open (from audit 2026-11-25):
- B8 (low) Keyboard/a11y gaps on sentence spans and control bar. Closed in Cycle 3: sentences focusable with button role and Enter/Space seek; control bar toolbar role + aria-live progress. Verified in Chromium 160 and Brave 1.78.102 e2e.

Fixed in Cycle 2 (in progress):
- B6 (low) Multi-column PDF interleaving. Fix: RAText.splitColumns partitions page text items at the column gutter (widest x-gap in the middle band, items on both sides); the reader rebuilds each column independently. Single-column pages take the identical path as before. Verified: 3 new unit tests + a row-major two-column PDF fixture passing in Chromium 160 and Brave 1.78.102 e2e (twoColumnOrdered: true), existing fixtures unregressed.

Fixed in Cycle 1 (2026-11-25):
- B1 (high) Pitch slider dead AND cleared selected voice. Fix: engine gained setPitch (mirrors setRate: applies to next utterance, re-speaks current one); reader pitch handler now calls setPitch(value) instead of setVoice(engine.voice). Verified: unit test (pitch applied, voice preserved) + real Firefox runtime (utterance recorded with pitch 1.6 AND the selected voice kept).
- B2 (high) Utterance chunking not wired. Fix: engine.load() hard-splits sentences over 260 chars at word boundaries into queue entries, with a sentenceMap so highlighting tracks the original sentence (reader and control bar use getState().sentenceIndex). Verified: unit test + real Firefox runtime (490-char sentence -> 2 utterances, max 258 chars, full content spoken, no truncation).
- B3 (medium) Chromium utterance stall. Fix: engine retains the live utterance (GC guard) and arms a watchdog per utterance: restarts never-started utterances (2 retries, then a speech-stalled error) and nudges resume() while speaking (Chrome long-utterance keep-alive; no-op elsewhere). Verified: unit test with a dropping mock synth (re-queued, then speech-stalled, state idle).
- B4 (medium) Popup state-blind on reopen. Fix: popup queries the tab reader for STATE on open and shows live progress ("Reading sentence N of M - state"). Verified: code-level (content script STATE handler already existed) + Chromium/Brave e2e suites unchanged and green.
- B5 (low) file:// failure message generic. Fix: popup now explains "Allow access to file URLs" and points to the built-in PDF/text reader.
- B7 (low) Unicode media glyphs vs SVG icons. Fix: reader controls and the on-page control bar now use inline SVG icons (pause button swaps play/pause SVG). Consistent with the popup; no tofu/emoji fallback.

Closed previously: whitespace normalization collapsing paragraph breaks; progress off-by-one; TTS failure stuck in speaking; error message overwritten by state updates; default_locale without _locales; missing data_collection_permissions; pdf.js EOL markers breaking dehyphenation; replay after completion dead.
