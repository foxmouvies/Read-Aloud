// Probe: does Chromium see real speech voices via system speech-dispatcher?
const puppeteer = require("puppeteer-core");
const CHROME = process.env.PROBE_BROWSER;
(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: process.env.HEADFUL ? false : "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--enable-speech-dispatcher"],
  });
  const page = await browser.newPage();
  await page.goto("about:blank");
  const voices = await page.evaluate(() => new Promise((resolve) => {
    const got = () => speechSynthesis.getVoices().map((v) => v.name + " [" + v.lang + "]" + (v.localService ? " local" : " remote"));
    const v = got();
    if (v.length) return resolve(v);
    speechSynthesis.onvoiceschanged = () => resolve(got());
    setTimeout(() => resolve([]), 6000);
  }));
  console.log("VOICES", voices.length, JSON.stringify(voices.slice(0, 10)));
  if (voices.length) {
    // Try an actual utterance and watch for end event.
    const spoke = await page.evaluate(() => new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance("Testing real speech delivery.");
      let ended = false;
      u.onend = () => { ended = true; resolve("end event fired"); };
      u.onerror = (e) => resolve("error: " + e.error);
      speechSynthesis.speak(u);
      setTimeout(() => resolve(ended ? "end fired late" : "timeout, no end event"), 12000);
    }));
    console.log("UTTERANCE:", spoke);
  }
  await browser.close();
})().catch((e) => { console.error("PROBE FAIL:", e.message); process.exit(1); });
