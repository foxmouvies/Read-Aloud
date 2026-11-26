/* Local HTML-to-text extraction for the reader's HTML file upload.
 * The file is parsed with DOMParser, which creates an inert document: scripts
 * never run, and no image, stylesheet, frame or other sub-resource is fetched.
 * Only text is taken from the parsed tree; nothing is inserted into the live
 * page as markup and nothing leaves the device. */
(function (root) {
  "use strict";
  var DROP = "script,style,noscript,template,iframe,frame,frameset,object,embed,applet,svg,math,canvas,audio,video,head,title,meta,link,base,select,option,datalist,textarea,input,button,form,nav,aside,footer,dialog,[hidden],[aria-hidden='true']";
  var BLOCK = "address,article,blockquote,br,dd,div,dl,dt,figcaption,figure,h1,h2,h3,h4,h5,h6,hr,li,main,ol,p,pre,section,table,tr,td,th,ul,header,caption,summary,details";

  // Whole class tokens only (not substrings): "comment-list" is boilerplate, "commentary" or "shareholder-letter" are not.
  var SKIP_TOKEN = /^(comments?|share|sharing|social|related|promo|sidebar|widget|advert|advertisement|newsletter|subscribe|cookie|breadcrumbs?|pagination|toolbar|popup|modal|banner|menu|nav|navbar|navigation)([-_](list|section|bar|buttons?|links?|posts?|articles?|stories|box|block|container|wrapper|area|form|items?|banner|notice))?$/;
  function isBoilerplateClass(cls) {
    var toks = String(cls).toLowerCase().split(/\s+/);
    for (var k = 0; k < toks.length; k++) if (toks[k] && SKIP_TOKEN.test(toks[k])) return true;
    return false;
  }

  function htmlToText(html) {
    var doc = new DOMParser().parseFromString(String(html), "text/html");
    var all = doc.querySelectorAll("*");
    var i, el, st;
    for (i = 0; i < all.length; i++) {
      el = all[i];
      st = (el.getAttribute("style") || "").replace(/\s+/g, "").toLowerCase();
      if (st.indexOf("display:none") !== -1 || st.indexOf("visibility:hidden") !== -1) el.setAttribute("hidden", "");
    }
    // Boilerplate blocks by class name (comments, share bars, sidebars...), as on the live-page route. A block
    // that holds most of the page text is never dropped, so a wrapper with an unlucky class name cannot empty the page.
    var bodyLen = ((doc.body && doc.body.textContent) || "").length || 1;
    var cands = doc.body ? doc.body.querySelectorAll("[class]") : [];
    var toDrop = [];
    var sem = doc.body ? doc.body.querySelector("article, main, [role=main]") : null;
    var semLen = sem ? (sem.textContent || "").trim().length : 0;
    for (i = 0; i < cands.length; i++) {
      var cls = cands[i].getAttribute("class") || "";
      if (!isBoilerplateClass(cls)) continue;
      // Page with a real article/main holding text: a boilerplate-class block outside it is always dropped.
      var outsideArticle = semLen > 40 && !sem.contains(cands[i]);
      if (outsideArticle || (cands[i].textContent || "").length < bodyLen * 0.6) toDrop.push(cands[i]);
    }
    for (i = 0; i < toDrop.length; i++) { if (toDrop[i].parentNode) toDrop[i].parentNode.removeChild(toDrop[i]); }
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
