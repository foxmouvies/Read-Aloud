#!/usr/bin/env python3
"""Regenerate the PDF fixtures that are not hand-built.
- sample-multipage.pdf: 15 pages, numbered sentences (long-document extraction).
The Arabic fixture (sample-arabic.pdf) is rendered from sample-arabic.html
with headless Chromium: --print-to-pdf (kept separate: needs a browser)."""
from reportlab.lib.pagesizes import LETTER
from reportlab.pdfgen import canvas

c = canvas.Canvas("test/fixtures/sample-multipage.pdf", pagesize=LETTER)
w, h = LETTER
for page in range(1, 16):
    y = h - 72
    for n in range(1, 5):
        if page == 1 and n == 1:
            line = "First page opening sentence begins the long document."
        elif page == 15 and n == 4:
            line = "Final page closing sentence ends the long document."
        else:
            line = f"Page {page} sentence {n} carries ordinary filler content for the reader."
        c.drawString(72, y, line)
        y -= 18
    c.showPage()
c.save()
print("sample-multipage.pdf written")
