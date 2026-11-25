#!/usr/bin/env python3
"""SYNTHETIC stress fixtures (not real scans): clean text rendered to images,
then laid out as mixed Arabic+English, two columns, and a page rotated 90 degrees."""
from PIL import Image, ImageDraw, ImageFont
AR="/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"; EN="/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"
W,H=1240,1754
def page(): return Image.new("L",(W,H),255)
fe=ImageFont.truetype(EN,34); fa=ImageFont.truetype(AR,38)
p1=page(); d=ImageDraw.Draw(p1); y=120
for kind,t in [("e","The harbour festival starts on Friday evening."),("a","يبدأ المهرجان في الميناء مساء الجمعة"),("e","Free shuttle buses leave from the main square."),("a","الحافلات المجانية تنطلق من الساحة الرئيسية")]:
    if kind=="e": d.text((100,y),t,font=fe,fill=0)
    else: d.text((W-100,y),t,font=fa,fill=0,anchor="ra",direction="rtl",language="ar")
    y+=110
p2=page(); d=ImageDraw.Draw(p2)
L=["Left column starts with lanterns.","They float across the bay.","Musicians play near the pier."]
R=["Right column lists the buses.","Route one serves the station.","Route two serves the market."]
for i,t in enumerate(L): d.text((90,150+i*90),t,font=ImageFont.truetype(EN,30),fill=0)
for i,t in enumerate(R): d.text((680,150+i*90),t,font=ImageFont.truetype(EN,30),fill=0)
p3=page(); d=ImageDraw.Draw(p3)
for i,t in enumerate(["This page was scanned sideways.","The reader should still find these words.","Final line of the rotated page."]): d.text((100,150+i*100),t,font=fe,fill=0)
p3=p3.rotate(90,expand=True)
p4=page(); d=ImageDraw.Draw(p4)
d.text((100,150),"Press the Start button to begin the reading today.",font=fe,fill=0)
d.text((100,260),"Please say the word",font=fe,fill=0)
d.text((520,254),"\u0645\u0631\u062D\u0628\u0627",font=ImageFont.truetype(AR,46),fill=0)
d.text((680,260),"when you arrive.",font=fe,fill=0)
p1.save("test/fixtures/stress-scans.pdf",save_all=True,append_images=[p2,p3,p4],resolution=150)
print("ok")
