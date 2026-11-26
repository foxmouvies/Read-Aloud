/* Cancelled and replaced scan loads (MOCK speech): Cancel text recognition leaves no document; a text file loaded while OCR runs hides the stale Cancel button. */
const fs=require("fs"),os=require("os"),path=require("path");
const puppeteer=require("puppeteer-core");
const EXT=path.resolve(__dirname,".."); const FX=EXT+"/test/fixtures/";
const CHROME=require("child_process").execSync("ls -d "+os.homedir()+"/chromium/linux-*/chrome-linux/chrome").toString().trim();
const MOCK=fs.readFileSync(EXT+"/test/fixtures/mock-speech.js","utf8");
const m=JSON.parse(fs.readFileSync(EXT+"/manifest.json","utf8")); const id=require("crypto").createHash("sha256").update(Buffer.from(m.key,"base64")).digest("hex").slice(0,32).split("").map(c=>String.fromCharCode(97+parseInt(c,16))).join("");
const sleep=t=>new Promise(r=>setTimeout(r,t));
(async()=>{
 const b=await puppeteer.launch({executablePath:CHROME,headless:"new",args:["--no-sandbox","--disable-gpu","--disable-features=DisableLoadExtensionCommandLineSwitch","--load-extension="+EXT,"--disable-extensions-except="+EXT,"--user-data-dir="+fs.mkdtempSync(path.join(os.tmpdir(),"cn-"))]});
 const errs=[]; let fail=0; const ck=(o,m)=>{console.log(o?"  ok:":"  FAIL:",m); if(!o)fail++;};
 for(const w of [320,390]){
  const p=await b.newPage(); await p.setViewport({width:w,height:640}); await p.evaluateOnNewDocument(MOCK); p.on("pageerror",e=>errs.push(e.message));
  await p.goto("chrome-extension://"+id+"/reader/reader.html");
  const st=()=>p.evaluate(()=>({prog:document.getElementById("progress").textContent.slice(0,100),sent:document.querySelectorAll("#text-view .sentence").length,cancelVisible:!document.getElementById("cancel-ocr").hidden,sw:document.documentElement.scrollWidth}));
  // 1 cancel mid-OCR
  await (await p.$("#file-input")).uploadFile(FX+"degraded-8page.pdf");
  await p.waitForFunction(()=>!document.getElementById("cancel-ocr").hidden,{timeout:20000}); await sleep(1500);
  await p.click("#cancel-ocr"); await sleep(800); let s=await st();
  ck(s.prog==="Text recognition cancelled."&&!s.cancelVisible&&s.sent===0&&s.sw<=w,w+" cancel mid-OCR: "+JSON.stringify(s));
  // 2 load a text file after cancel
  const tf=path.join(fs.mkdtempSync(path.join(os.tmpdir(),"cn-f-")),"plain-text-file"); fs.writeFileSync(tf,"No extension file. Reads fine."); await (await p.$("#file-input")).uploadFile(tf); await sleep(1500); s=await st();
  ck(/^Loaded plain-text-file/.test(s.prog)&&s.sent===2,w+" file loads after cancel: "+s.prog);
  // 3 OCR then replace with text file mid-OCR
  await (await p.$("#file-input")).uploadFile(FX+"degraded-8page.pdf"); await p.waitForFunction(()=>!document.getElementById("cancel-ocr").hidden,{timeout:20000}); await sleep(800);
  await (await p.$("#file-input")).uploadFile(tf); await sleep(3000); s=await st();
  ck(/^Loaded plain-text-file/.test(s.prog)&&s.sent===2&&!s.cancelVisible,w+" replace mid-OCR by text file: "+JSON.stringify(s));
  // 4 cancel twice quickly, then reload OCR and let finish a page? just cancel again
  await (await p.$("#file-input")).uploadFile(FX+"degraded-8page.pdf"); await p.waitForFunction(()=>!document.getElementById("cancel-ocr").hidden,{timeout:20000});
  await p.click("#cancel-ocr").catch(()=>{}); await p.click("#cancel-ocr").catch(()=>{}); await sleep(800); s=await st();
  ck(s.prog==="Text recognition cancelled."&&s.sent===0,w+" double cancel: "+s.prog);
  await p.click("#play").catch(()=>{}); await sleep(300); s=await st(); ck(s.sent===0,w+" play after cancel does nothing, sentences="+s.sent);
  await p.screenshot({path:"/tmp/cancel-"+w+".png"});
 }
 ck(errs.length===0,"page errors: "+JSON.stringify(errs).slice(0,200));
 await b.close(); console.log(fail?"CANCEL LOAD: "+fail+" FAILED":"CANCEL LOAD E2E PASS (mock speech)"); process.exit(fail?1:0); 
})().catch(e=>console.log("ERR",e.message));
