"""Procedural, original whiteboard-animation renderer for the Arabic video."""
from __future__ import annotations
import math, subprocess, sys, wave
from pathlib import Path
from PIL import Image, ImageDraw
from arabic import ARABIC_FONT, LATIN_FONT, get_font, draw_text

W, H, FPS = 1280, 720, 10
INK = (28, 36, 43); MUTED = (105, 117, 126); TEAL = (12, 145, 145)
CORAL = (231, 111, 81); GOLD = (241, 184, 65); PALE = (239, 247, 245)
WHITE = (255,255,255); SKIN=(239,190,145)
FONT = get_font(ARABIC_FONT, 42); BIG = get_font(ARABIC_FONT, 54); SMALL = get_font(ARABIC_FONT, 26)

# Three evolving boards per script chapter: all artwork is drawn from scratch.
BOARDS = [
 ('اتجاه صغير، فرق كبير','اختر الاتجاه الذي تكرره', 'split', ['تحسّن بسيط','تراجع بسيط','سنة كاملة']),
 ('البذرة لا تصبح شجرة في ليلة','النتائج تحتاج وقتًا لتظهر', 'seed', ['ازرع','اسقِ','راقب النمو']),
 ('منطقة الإحباط','الجهد يسبق النتيجة', 'ice', ['جهد يومي','عتبة الظهور','نتيجة مرئية']),
 ('تراكم أم تراجع؟','المعادلة توضيح، لا وعد', 'curve', ['١٪ كل يوم','نحو ٣٧٫٨×','نمو غير خطي']),
 ('عشر دقائق تصنع إيقاعًا','ابدأ بفعل صغير قابل للتكرار', 'small', ['صفحة واحدة','مشي قصير','جملة واحدة']),
 ('قاعدة الدقيقتين','اجعل البداية سهلة', 'two', ['افتح الكتاب','ارتدِ الحذاء','اكتب جملة']),
 ('صمّم بيئتك','قلّل الاحتكاك أمام العادة', 'environment', ['الكتاب قريب','الحذاء جاهز','الهاتف بعيد']),
 ('أربع مفاتيح للعادات','إشارة • رغبة • سهولة • رضا', 'four', ['واضحة','جذابة','سهلة','مُرضية']),
 ('إذا حدث كذا...','فهذا ما سأفعله', 'ifthen', ['بعد الإفطار','أقرأ صفحة','بعد الغداء: أمشي']),
 ('لا تنتظر يومًا مثاليًا','اربط الفعل بإشارة موجودة', 'chain', ['إشارة','فعل صغير','تكرار']),
 ('ليس ٢١ يومًا للجميع','العادة تختلف باختلاف الشخص', 'calendar', ['١٨ يومًا','٦٦ يومًا','٢٥٤ يومًا']),
 ('التلقائية لها مدى واسع','الوسيط ٦٦ يومًا في دراسة', 'range', ['نوع السلوك','الظروف','الوقت يختلف']),
 ('التعثر ليس نهاية','ارجع في الفرصة التالية', 'return', ['يوم فائت','عودة','استمرار']),
 ('من النتيجة إلى الهوية','هدف • نظام • هوية', 'layers', ['٢٠ كتابًا','١٠ صفحات مساءً','شخص يتعلم']),
 ('كل فعل صوت صغير','اجمع أدلة على هويتك', 'votes', ['قارئ','متعلم','يمشي اليوم']),
 ('اجعل السلوك طبيعيًا','التكرار يغيّر سؤال البداية', 'identity', ['هل سأفعل؟','أبدأ صغيرًا','هذا ما أفعله']),
 ('الأثر يعمل في الاتجاهين','لاحظ دون لوم نفسك', 'dual', ['تصفح متأخر','إنفاق متكرر','كلمة طيبة']),
 ('صمّم من جديد','سهّل ما تريد وزِد صعوبة ما يقلقك', 'redesign', ['قلّل الإغراء','قرّب البديل','استعد للتكرار']),
 ('اختر عادة واحدة','صغيرة • واضحة • مرتبطة بوقت', 'one', ['بعد كذا','سأفعل كذا','غدًا أبدأ']),
 ('خطوة ثم فرصة أخرى','اكتب عادتك في التعليقات', 'end', ['ابدأ صغيرًا','عد غدًا','شارك الفكرة']),
 ('ابدأ من مكانك','لا تنتظر القفزة الكبيرة', 'path', ['اليوم','خطوة صغيرة','اتجاه جديد']),
 ('الأثر التراكمي','العادات الصغيرة تصنع اتجاهًا', 'final', ['إشارة','فعل','تكرار']),
 ('راقب التقدم','لا تحكم من يوم واحد', 'track', ['ابدأ','كرّر','لاحظ']),
 ('إلى اللقاء','ما عادتك الصغيرة القادمة؟', 'end', ['اختر واحدة','اربطها بإشارة','ابدأ غدًا']),
]


def text_center(d, xy, text, font=FONT, fill=INK):
    draw_text(d, xy, text, font, fill, anchor='mm')

def line(d, pts, fill=INK, width=5): d.line(pts, fill=fill, width=width, joint='curve')
def circle(d, box, outline=INK, width=5, fill=None): d.ellipse(box, outline=outline, width=width, fill=fill)

def hand(d, x, y, phase=0):
    """Friendly illustrated hand holding a marker; pen tip touches current stroke."""
    # sleeve / wrist
    d.rounded_rectangle((x-6,y+10,x+27,y+50), radius=12, fill=(233,238,237), outline=INK, width=2)
    # palm and curled fingers
    d.ellipse((x-15,y-8,x+29,y+27), fill=SKIN, outline=INK, width=2)
    d.ellipse((x-10,y-19,x+11,y+10), fill=SKIN, outline=INK, width=2)
    d.ellipse((x+2,y-17,x+22,y+12), fill=SKIN, outline=INK, width=2)
    # marker at a gentle diagonal, nib at (x,y)
    line(d, [(x+7,y+3),(x+40,y-29)], INK, 7)
    line(d, [(x+34,y-24),(x+42,y-32)], CORAL, 4)


def icon(d, kind, cx, cy, labels):
    # Icons are intentionally simple, bold line art and reuse the same visual grammar.
    if kind in ('split','dual','curve','track','path','final'):
        line(d,[(cx-390,cy+120),(cx-390,cy-130),(cx+380,cy-130)],MUTED,3)
        if kind in ('split','dual'):
            line(d,[(cx-330,cy+70),(cx-120,cy+70),(cx+90,cy-45),(cx+300,cy-110)],TEAL,9)
            line(d,[(cx-330,cy+70),(cx-120,cy+70),(cx+90,cy+115),(cx+300,cy+150)],CORAL,8)
            circle(d,(cx+280,cy-130,cx+320,cy-90),TEAL,5,WHITE); circle(d,(cx+280,cy+130,cx+320,cy+170),CORAL,5,WHITE)
        else:
            pts=[]
            for i in range(61):
                t=i/60; x=cx-340+t*680; y=cy+125-245*(t**2.5)
                pts.append((int(x),int(y)))
            line(d,pts,TEAL,8)
            for i in [5,20,40,58]: circle(d,(pts[i][0]-8,pts[i][1]-8,pts[i][0]+8,pts[i][1]+8),CORAL,3,CORAL)
        text_center(d,(cx-270,cy+180),labels[0],SMALL,TEAL); text_center(d,(cx+230,cy+180),labels[-1],SMALL,CORAL)
    elif kind in ('seed','ice'):
        # Three growth / melting stages
        centers=[cx-270,cx,cx+270]
        for j,x in enumerate(centers):
            circle(d,(x-62,cy-58,x+62,cy+66),TEAL,5,(250,253,252))
            if kind=='seed':
                d.ellipse((x-23,cy+14,x+24,cy+42),fill=GOLD,outline=INK,width=3)
                line(d,[(x,cy+12),(x,cy-25)],TEAL,5)
                if j>0: line(d,[(x,cy-14),(x-21,cy-32)],TEAL,4)
                if j>1: line(d,[(x,cy-20),(x+21,cy-39)],TEAL,4)
            else:
                d.polygon([(x-24,cy-4),(x+24,cy-4),(x+13,cy+31),(x-14,cy+31)], fill=(170,218,225),outline=TEAL)
                line(d,[(x,cy-34),(x,cy-8)],TEAL,4)
                if j==2: line(d,[(x,cy+35),(x+33,cy+54)],CORAL,4)
            text_center(d,(x,cy+100),labels[j],SMALL,INK)
            if j<2: line(d,[(x+75,cy),(x+175,cy)],GOLD,5); d.polygon([(x+175,cy),(x+158,cy-10),(x+158,cy+10)],fill=GOLD)
    elif kind in ('small','two','environment','four','ifthen','chain','calendar','range','return','layers','votes','identity','redesign','one','end'):
        # Three panels with type-specific hand-drawn symbols.
        xs=[cx-315,cx,cx+315]
        for j,x in enumerate(xs):
            d.rounded_rectangle((x-120,cy-115,x+120,cy+165),radius=24,outline=(210,220,219),width=3,fill=(253,254,253))
            c=[TEAL,CORAL,GOLD][j]
            if kind in ('small','two'):
                if j==0: # open book
                    line(d,[(x,cy-40),(x,cy+42)],INK,5); line(d,[(x,cy-38),(x-70,cy-52),(x-70,cy+32),(x,cy+43)],c,5); line(d,[(x,cy-38),(x+70,cy-52),(x+70,cy+32),(x,cy+43)],c,5)
                elif j==1: # shoe
                    line(d,[(x-70,cy+25),(x-37,cy-12),(x+15,cy-10),(x+46,cy+17),(x+75,cy+28),(x+67,cy+43),(x-63,cy+43),(x-70,cy+25)],c,6)
                    for k in range(3): line(d,[(x-12+k*17,cy+3),(x-1+k*14,cy+13)],INK,2)
                else: # pencil
                    line(d,[(x-38,cy+42),(x+35,cy-40)],c,10); line(d,[(x+35,cy-40),(x+47,cy-52)],INK,4)
            elif kind in ('four','ifthen','chain'):
                if j==0: circle(d,(x-40,cy-55,x+40,cy+25),c,6); line(d,[(x,cy+25),(x,cy+60)],INK,4)
                elif j==1: d.polygon([(x,cy-58),(x+49,cy+15),(x,cy+53),(x-49,cy+15)],fill=(255,245,225),outline=c); line(d,[(x,cy-26),(x,cy+28)],c,4)
                else: d.rounded_rectangle((x-50,cy-45,x+50,cy+48),radius=12,outline=c,width=6); line(d,[(x-25,cy),(x-5,cy+20),(x+30,cy-20)],TEAL,5)
            elif kind in ('calendar','range','return'):
                d.rounded_rectangle((x-56,cy-56,x+56,cy+56),radius=8,outline=c,width=5)
                line(d,[(x-56,cy-24),(x+56,cy-24)],c,4); line(d,[(x-28,cy-70),(x-28,cy-43)],INK,5); line(d,[(x+28,cy-70),(x+28,cy-43)],INK,5)
                if j==1: text_center(d,(x,cy+10),'٦٦',BIG,c)
                elif j==0: text_center(d,(x,cy+10),'١٨',SMALL,INK)
                else: text_center(d,(x,cy+10),'٢٥٤',SMALL,INK)
                if kind=='return' and j==1: line(d,[(x-33,cy+83),(x+15,cy+83),(x+39,cy+65)],TEAL,5)
            elif kind in ('layers','identity'):
                for k in range(3): d.rounded_rectangle((x-70+k*8,cy-57+k*40,x+70-k*8,cy-20+k*40),radius=10,outline=[TEAL,CORAL,GOLD][k],width=5)
            elif kind=='votes':
                for k in range(j+1):
                    xx=x-34+k*22; yy=cy+28-k*12
                    circle(d,(xx-18,yy-65,xx+18,yy-29),c,3,WHITE); line(d,[(xx,yy-29),(xx,yy+36)],INK,4); line(d,[(xx,yy-1),(xx-22,yy+18)],INK,3); line(d,[(xx,yy-1),(xx+22,yy+18)],INK,3)
            elif kind=='environment':
                if j==0: # book on stand
                    d.rectangle((x-47,cy-48,x+47,cy+41),outline=c,width=5); line(d,[(x-40,cy-20),(x+37,cy-20)],INK,3)
                elif j==1: circle(d,(x-47,cy-48,x+47,cy+48),c,5); line(d,[(x-15,cy+2),(x,cy+20),(x+33,cy-20)],TEAL,5)
                else:
                    d.rounded_rectangle((x-34,cy-63,x+34,cy+45),radius=11,outline=c,width=5); line(d,[(x-20,cy+58),(x+20,cy+58)],INK,4); line(d,[(x-57,cy-72),(x+57,cy+55)],CORAL,6)
            else:
                # prompt/step/check panel
                d.ellipse((x-39,cy-51,x+39,cy+27),outline=c,width=5)
                line(d,[(x-18,cy-7),(x-2,cy+10),(x+24,cy-23)],TEAL,5)
            text_center(d,(x,cy+116),labels[j],SMALL,INK)
    else:
        text_center(d,(cx,cy),labels[0],BIG,TEAL)


def make_base(title, sub, kind, labels, visible):
    im=Image.new('RGB',(W,H),WHITE); d=ImageDraw.Draw(im)
    # Margin framing and chapter label
    d.rounded_rectangle((34,30,W-34,H-32),radius=22,outline=(233,238,236),width=2)
    d.rounded_rectangle((68,52,222,95),radius=18,fill=PALE)
    draw_text(d,(145,74),'فكرة صغيرة',SMALL,TEAL,anchor='mm')
    text_center(d,(W//2,126),title,BIG,INK)
    d.rounded_rectangle((W//2-250,161,W//2+250,168),radius=3,fill=GOLD)
    text_center(d,(W//2,205),sub,SMALL,MUTED)
    # Progressive reveal stages are independently rendered, so the pen visibly draws each element.
    if visible>=1: icon(d,kind,W//2,355,labels)
    return im


def chapter_durations():
    durations=[]
    for i in range(1,9):
        with wave.open(f'build/vo/scene{i:02}.wav','rb') as wf: durations.append(wf.getnframes()/wf.getframerate())
    return durations


def render(outpath):
    # 3 boards per chapter; duration is apportioned evenly within each narration section.
    chapter_secs=chapter_durations()
    plans=[]
    for i,sec in enumerate(chapter_secs):
        for j in range(3): plans.append((BOARDS[i*3+j],sec/3))
    # Round most boards independently, then extend the final card so the video
    # always covers the complete narration rather than cutting off its last syllable.
    target_frames=math.ceil(sum(chapter_secs)*FPS)
    planned_frames=sum(max(1,round(dur*FPS)) for _,dur in plans)
    extra_frames=max(0,target_frames-planned_frames)
    ffmpeg=__import__('imageio_ffmpeg').get_ffmpeg_exe()
    cmd=[ffmpeg,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p',outpath]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        for idx,(board,dur) in enumerate(plans):
            title,sub,kind,labels=board
            frames=max(1,round(dur*FPS))+(extra_frames if idx==len(plans)-1 else 0); bases=[make_base(title,sub,kind,labels,stage) for stage in (0,1,2)]
            for n in range(frames):
                t=n/FPS
                stage=0 if t<0.6 else 1 if t<1.5 else 2
                im=bases[stage].copy(); d=ImageDraw.Draw(im)
                # Continuous hand-traced progress stroke, with the hand and marker kept in-frame.
                q=n/max(1,frames-1); x0=102; x1=1170; y=570; x=int(x0+(x1-x0)*q)
                line(d,[(x0,y),(x,y)],TEAL,4)
                for mark in (0.0,.25,.5,.75,1.0):
                    xx=int(x0+(x1-x0)*mark); circle(d,(xx-4,y-4,xx+4,y+4),TEAL,1,TEAL)
                hand(d,x,y, n)
                proc.stdin.write(im.tobytes())
            print(f'board {idx+1}/{len(plans)} {dur:.1f}s',flush=True)
        proc.stdin.close()
        err=proc.stderr.read().decode('utf-8','replace')
        rc=proc.wait()
        if rc: raise RuntimeError(err[-4000:])
    finally:
        if proc.poll() is None: proc.kill()

if __name__=='__main__':
    render(sys.argv[1] if len(sys.argv)>1 else 'build/render/boards.mp4')
