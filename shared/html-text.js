/* Local HTML-to-text extraction for the reader's HTML file upload.
 * The file is parsed with DOMParser, which creates an inert document: scripts
 * never run, and no image, stylesheet, frame or other sub-resource is fetched.
 * Only text is taken from the parsed tree; nothing is inserted into the live
 * page as markup and nothing leaves the device. */
(function (root) {
  "use strict";
  var DROP = "script,style,noscript,template,iframe,frame,frameset,object,embed,applet,svg,math,canvas,audio,video,head,title,meta,link,base,select,option,datalist,textarea,input,button,form,nav,aside,footer,dialog,[hidden],[aria-hidden='true']";
  var BLOCK = "address,article,blockquote,br,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,hr,li,main,ol,p,pre,section,table,tr,td,th,ul,header,caption";

  function htmlToText(html) {
    var doc = new DOMParser().parseFromString(String(html), "text/html");
    var all = doc.querySelectorAll("*");
    var i, el, st;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      st = (el.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
      if (st.indexOf("display:none") !== -1 || st.indexOf("visibility:hidden") !== -1) el.setAttribute("hidden", "");
    }
    var drop = doc.querySelectorAll(DROP);
    for (i = 0; i < drop.length; i++) { if (drop[i].parentNode) drop[i].parentNode.removeChild(drop[i]); }
    var body = doc.body;
    if (!body) return "";
    // Prefer the main content region when the page has one with real text.
    var main = body.querySelector("main, article, [role='main']");
    var scope = main && (main.textContent || "").replace(/\s+/g, " ").trim().length > 200 ? main : body;
    var blocks = scope.querySelectorAll(BLOCK);
    for (i = 0; i < blocks.length; i++) {
      blocks[i].appendChild(doc.createTextNode("\n"));
      blocks[i].insertBefore(doc.createTextNode("\n"), blocks[i].firstChild);
    }
    return scope.textContent || "";
  }

  var api = { htmlToText: htmlToText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RAHtml = api;
})(typeof self !== "undefined" ? self : this);
