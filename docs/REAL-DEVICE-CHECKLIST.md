# ReadAloud v1.0.7 - real-device validation checklist

Purpose: confirm on a real machine what the automated test environment cannot
(headless browsers here have no speech voices and cannot deliver messages to
injected scripts in Firefox). Everything else is already verified in
automation; this is a short confirmation pass, about 5 minutes per browser.

## A. Firefox (desktop, any current version)

1. Open `about:debugging` > "This Firefox" > "Load Temporary Add-on" and pick
   `manifest.json` from the unzipped readaloud-extension-v1.0.7.zip.
2. Open any news/article page. Click the ReadAloud toolbar button, then
   "Read page".
   Expected: the on-page control bar appears and reading starts at sentence 1
   with audible speech. (This is the step automation could not verify.)
3. Pause, Resume and Stop from the control bar. Reopen the toolbar popup:
   it shows live progress ("Reading sentence N of M").
4. Voice privacy: if the machine has normal system voices, reading just works
   with no online-voice prompt. If it has none, playback pauses with an
   explanation and an "Allow online voices" choice.
5. Resume: stop after a few sentences, reload the page, click "Read page"
   again. Expected: reading resumes near where it stopped.
6. Reader page: open the reader, load a PDF or .txt, press Play (audible).
   Later, re-upload the same file: it offers/resumes at the saved sentence.
7. Popup > "Clear saved data": afterwards, resume no longer happens.

## B. Brave (current desktop release)

1. `brave://extensions` > Developer mode > "Load unpacked" with the unzipped
   extension folder.
2. Repeat steps A2-A7. This also verifies Brave speech output, which
   automation here cannot (0 voices in the test environment).

## What to report back

For each browser: pass/fail per step, the exact browser version, any error
text shown, and whether speech was actually heard. A screenshot of any
failure helps. Nothing here sends data anywhere; all storage stays local.
