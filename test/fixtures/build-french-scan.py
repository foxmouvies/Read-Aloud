#!/usr/bin/env python3
"""SYNTHETIC French scan (clean text rendered to an image, not a real scan)."""
from PIL import Image, ImageDraw, ImageFont
EN="/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
L=["Le festival du port commence vendredi soir.","Les musiciens jouent près de la jetée, où les enfants dansent.","Nous vous attendons tous à côté du café de la gare."]
p=Image.new("L",(1240,700),255); d=ImageDraw.Draw(p); f=ImageFont.truetype(EN,34)
for i,t in enumerate(L): d.text((100,120+i*110),t,font=f,fill=0)
p.save("test/fixtures/scanned-fr.pdf",resolution=150)
