# Product requirements

## Functional (current)
F1 Read the main text of a web page aloud. F2 Read a text selection. F3 Read PDF files (text layer). F4 Read plain-text files. F5 Play/pause/resume/stop/prev/next. F6 Rate 0.5-2x. F7 Voice selection. F8 Pitch adjustment (broken: B1). F9 Sentence highlighting + click-to-start in the reader. F10 On-page floating control bar. F11 Arabic-aware sentence splitting.

## Functional (roadmap)
F12 Continuous reading across sections. F13 Progress tracking + resume. F14 Settings persistence. F15 Page sentence highlighting. F16 Keyboard shortcuts. F17 Localized UI (Arabic first).

## Non-functional
NF1 Minimal permissions; any new permission requires explicit owner consent. NF2 No network calls from the extension. NF3 No data collection. NF4 Works offline with local voices. NF5 Readable performance on book-length documents. NF6 Accessible (keyboard, ARIA). NF7 Verified on real Firefox and Brave before any release claim.

## Acceptance (per release)
All unit + e2e tests green on Chromium and real Firefox; real-audio playback verified in Firefox; defects from the previous cycle closed or documented; cycle report delivered.
