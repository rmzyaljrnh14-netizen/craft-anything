from PIL import Image,ImageDraw
from pathlib import Path
from arabic import ARABIC_FONT, get_font, draw_text
ROOT=Path(__file__).resolve().parents[2]
P=ROOT/'output'/'الأثر-التراكمي-العادات-الصغيرة'/'02_Thumbnail.png'; P.parent.mkdir(parents=True,exist_ok=True)
W,H=1280,720
im=Image.new('RGB',(W,H),(250,248,242)); d=ImageDraw.Draw(im)
ink=(27,38,44); teal=(13,145,143); coral=(229,105,78); gold=(239,183,64); muted=(111,119,118)
# Soft framed, hand-drawn editorial look
d.rounded_rectangle((24,24,W-24,H-24),radius=34,outline=(228,223,210),width=3)
# Left: one clear growth metaphor, seed -> tree, with a rising hand-drawn path.
d.line([(86,564),(180,564),(270,548),(355,511),(433,452),(503,374),(563,287)],fill=teal,width=11,joint='curve')
for x,y in [(178,564),(280,544),(385,483),(480,400)]: d.ellipse((x-10,y-10,x+10,y+10),fill=gold,outline=ink,width=3)
# Sprout/tree as one main motif
# trunk & branches
d.line([(552,430),(552,254)],fill=ink,width=15)
d.line([(552,340),(488,288)],fill=ink,width=10); d.line([(552,324),(615,260)],fill=ink,width=10)
d.line([(552,377),(493,354)],fill=teal,width=7); d.line([(552,364),(620,333)],fill=teal,width=7)
for box,c in [((456,235,527,302),teal),((525,168,598,245),gold),((590,221,660,290),coral),((463,310,526,368),gold),((594,298,657,360),teal)]:
 d.ellipse(box,fill=(250,248,242),outline=c,width=8)
# small soil/seed visual
d.arc((480,412,624,472),0,180,fill=muted,width=5)
d.ellipse((536,439,568,458),fill=gold,outline=ink,width=3)
# marker hand at curve endpoint
d.rounded_rectangle((542,500,574,559),radius=12,fill=(237,240,237),outline=ink,width=3)
d.ellipse((529,474,580,520),fill=(239,190,145),outline=ink,width=3)
d.line([(566,484),(610,439)],fill=ink,width=11); d.line([(605,444),(617,432)],fill=coral,width=6)
# Accent sparks
for x,y in [(433,320),(669,185),(685,341)]:
 d.line([(x-10,y),(x+10,y)],fill=gold,width=5); d.line([(x,y-10),(x,y+10)],fill=gold,width=5)
# Right: compact, high-contrast Arabic headline
f1=get_font(ARABIC_FONT,75); f2=get_font(ARABIC_FONT,88); f3=get_font(ARABIC_FONT,35)
draw_text(d,(1195,205),'قوة العادات',f1,ink,anchor='ra')
draw_text(d,(1195,318),'الصغيرة',f2,teal,anchor='ra')
d.rounded_rectangle((710,374,1200,383),radius=4,fill=gold)
draw_text(d,(1195,452),'خطوة صغيرة…',f3,muted,anchor='ra')
draw_text(d,(1195,505),'فرق كبير!',f1,coral,anchor='ra')
# Badge
# no logo/watermark
im.save(P,optimize=True)
print(P)
