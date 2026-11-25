// Shared web-page fixtures for the Chromium/Brave e2e and the Firefox runtime test.
const ARTICLE_HTML = `<!DOCTYPE html><html><head><title>Test article</title></head><body>
<nav>Menu link one. Menu link two.</nav>
<article>
<h1>Why reading aloud matters</h1>
<p>Listening to text helps many people. It supports focus and accessibility.</p>
<p>Dr. Smith measured a 3.5 point improvement. The results were clear.</p>
<p>Short sentence. Another one here. And a final thought for today.</p>
</article>
<footer>Copyright footer text.</footer>
</body></html>`;

const COMPLEX_HTML = `<!DOCTYPE html><html><head><title>Complex page</title></head><body>
<nav class="site-nav">Navigation marker Northex.
<a href="/a">Link alpha</a> <a href="/b">Link beta</a> <a href="/c">Link gamma</a></nav>
<div class="layout">
<div class="sidebar widget">Sidebar marker Zelphia.
<ul>
<li><a href="/1">Sidebar link number one with a long title</a></li>
<li><a href="/2">Sidebar link number two with a long title</a></li>
<li><a href="/3">Sidebar link number three with a long title</a></li>
<li><a href="/4">Sidebar link number four with a long title</a></li>
<li><a href="/5">Sidebar link number five with a long title</a></li>
</ul></div>
<div class="post-body content">
<h1>Article body marker Sentex headline</h1>
<p>Article body marker Sentex opens this paragraph with a full sentence of meaningful report text that runs long enough to count as a real block of article content for the extractor.</p>
<p>The second paragraph continues the report with more detail about the story, adding context and explanation that a reader would expect in the middle of a genuine published article on the web.</p>
<p>A third paragraph keeps the narrative going and brings the word count higher still, so the container scores well above the boilerplate that surrounds it on every side of the page layout.</p>
<p>The final paragraph closes the article with a summary of the piece and one last distinctive phrase, Article body marker Sentex closes, for the accuracy check to find.</p>
</div>
<div class="related-links">Related marker Quorin.
<a href="/r1">Related story one</a> <a href="/r2">Related story two</a></div>
</div>
<div style="display:none">Hidden marker Invisia.</div>
<footer>Footer marker Davron. Copyright and legal lines.</footer>
</body></html>`;

module.exports = { ARTICLE_HTML, COMPLEX_HTML };
