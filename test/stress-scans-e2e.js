// SYNTHETIC stress test (generated images, not real scans): two columns read column by column, a sideways page, mixed Arabic+English.
const fs=require("fs"),os=require("os"),path=require("path");const puppeteer=require("puppeteer-core");
const EXT=process.env.HOME+"/readaloud";const CH=process.env.E2E_BROWSER||require("child_process").execSync("ls -d "+os.homedir()+"/chromium/linux-*/chrome-linux/chrome").toString().trim();
const m=JSON.parse(fs.readFileSync(EXT+"/manifest.json"));const id=(()=>{const h=require("crypto").createHash("sha256").update(Buffer.from(m.key,"base64")).digest().slice(0,16);return [...h].map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join("")})();
(async()=>{const b=await puppeteer.launch({executablePath:CH,headless:"new",args:["--no-sandbox","--disable-gpu","--disable-features=DisableLoadExtensionCommandLineSwitch","--load-extension="+EXT,"--disable-extensions-except="+EXT]});
const p=await b.newPage();await p.goto(`chrome-extension://${id}/reader/reader.html`);
await(await p.$("#file-input")).uploadFile(EXT+"/test/fixtures/stress-scans.pdf");
await p.waitForFunction(()=>/^Loaded|rror|No text|could not/i.test(document.getElementById("progress").textContent),{timeout:110000});
console.log(await p.evaluate(()=>document.getElementById("progress").textContent));
const txt=await p.evaluate(()=>[...document.querySelectorAll("#text-view .sentence")].map(s=>s.textContent).join("\n"));console.log(txt);
const ord=["Left column starts","They float","Musicians play","Right column lists","Route one","Route two","scanned sideways","rotated page"];let at=-1,bad=[];for(const w of ord){const i=txt.indexOf(w);if(i<=at)bad.push(w);at=Math.max(at,i);}
const merged=txt.split("\n").some(l=>l.includes("الميناء")&&/Free shuttle/.test(l));
if(merged)bad.push("arabic+english merged in one sentence");
if(bad.length||!txt.includes("الميناء")){console.log("STRESS SCANS FAIL",bad);process.exitCode=1}else console.log("STRESS SCANS (synthetic): two-column order, sideways page and mixed Arabic/English recognised: PASS");await b.close();process.exit(process.exitCode||0);})();
