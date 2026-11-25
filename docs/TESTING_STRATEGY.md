# Testing strategy

Layers:
1. Unit (node:test): shared/text.js, shared/tts-engine.js with mocked speechSynthesis. Every bug gets a failing test first where practical.
2. Browser e2e (Chromium/Brave via puppeteer-core): load, PDF flow, article flow, control bar, popup.
3. Real Firefox runtime (geckodriver, sideloaded profile, local speech-dispatcher voices): extension active, real PDF extraction, full playback with recorded audio, pause/resume/stop, replay.
4. Mozilla validator (web-ext lint): 0 errors required.

Rules: no completion claims without real Firefox runtime evidence and an honest statement of what was not verified. Chromium results are supporting evidence, never Brave validation. Cycle 2 adds fixtures: complex page, two-column PDF, Arabic, long document, special characters. Cycle 4 adds performance/memory benchmarks.
