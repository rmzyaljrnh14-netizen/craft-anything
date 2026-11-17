"""Render an 11.5 s Arabic whiteboard sample from the user's storyboard image.

The storyboard panel is shown briefly as a reference, then replaced by original,
hand-authored SVG pen strokes. The input image is never image-traced or revealed
as the drawing. The writing hand is a generated cursor cutout that follows each
active path tip. Run with the repo's production venv and local Arabic font present.
"""
from __future__ import annotations

import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
from svgpathtools import parse_path

ROOT=Path(__file__).resolve().parents[2]
PREVIEW=ROOT/'preview'
REF=PREVIEW/'references/overthinking_panel_00.png'
HAND_REF=PREVIEW/'references/whiteboard_hand_cursor_reference.png'
VOICE_ART=PREVIEW/'references/overthinking_art_voice.wav'
VOICE_TITLE=PREVIEW/'references/overthinking_title_voice.wav'
OUT=PREVIEW/'overthinking_drawing_sample.mp4'
SRT=PREVIEW/'overthinking_drawing_sample.srt'
W,H,FPS,DURATION=1920,1080,30,11.5
S=1.5
INK=(29,36,42); BLUE=(24,96,184); TEAL=(25,140,154); GOLD=(224,171,46); GRAY=(112,123,131); PALE=(232,240,245)

# Original vector redraw based on the first 0:00–0:10 storyboard panel.
# Coordinates are composed on a 1280x720 artboard to match the reference layout:
# worried figure at left, thought cloud above, crescent beside it, title at right.
RAW=[]
def stroke(d,color=INK):RAW.append((d,color))
# Crescent moon and small night marks (seven pen-up paths).
stroke('M 652 78 C 624 88 607 116 613 145 C 620 179 655 195 684 180 C 664 179 648 167 641 150 C 631 127 638 99 652 78 Z',BLUE)
stroke('M 690 93 L 700 86',BLUE)
stroke('M 710 117 L 721 117',BLUE)
stroke('M 690 143 L 699 151',BLUE)
stroke('M 735 78 L 742 69',GRAY)
stroke('M 754 104 L 767 102',GRAY)
stroke('M 737 138 L 747 146',GRAY)
# Thought cloud, dotted trail, and compact restless scribble (twelve paths).
stroke('M 83 251 C 48 245 37 219 52 193 C 37 168 51 137 79 130 C 82 99 111 79 142 91 C 166 62 208 65 229 91 C 260 76 296 91 301 119 C 337 115 358 142 349 170 C 374 191 365 223 340 236 C 320 258 287 257 261 245 C 239 268 201 269 179 250 C 153 266 119 263 103 246 C 96 250 89 251 83 251 Z',INK)
stroke('M 327 254 C 340 261 344 271 339 280',INK)
stroke('M 355 290 C 364 298 362 307 356 312',INK)
stroke('M 374 323 C 381 330 379 339 373 344',INK)
stroke('M 112 181 C 127 143 174 128 209 146 C 239 162 237 196 208 211 C 181 225 145 212 151 185 C 157 162 192 155 211 172 C 232 190 217 214 193 213 C 172 212 166 192 180 178 C 195 164 220 169 227 186 C 238 213 210 232 181 229 C 146 226 123 206 128 181 C 133 158 157 142 184 143',INK)
stroke('M 122 195 C 147 186 145 155 175 151 C 202 147 217 167 202 179 C 184 194 160 177 173 162 C 189 144 226 155 236 181',INK)
stroke('M 132 162 C 157 167 166 207 193 208 C 219 209 232 180 216 165 C 201 151 182 159 184 177 C 186 192 211 198 230 186',INK)
stroke('M 143 213 C 164 195 193 203 204 222 C 216 240 194 247 177 236 C 160 225 172 207 192 207 C 215 207 230 225 245 231',INK)
stroke('M 79 117 L 69 108',GRAY)
stroke('M 61 204 L 48 208',GRAY)
stroke('M 304 105 L 314 98 M 351 203 L 364 207',GRAY)
# Worried young man: irregular hair silhouette, swept fringe, and loose strands.
stroke('M 113 516 C 80 499 69 465 80 434 C 60 407 68 372 91 354 C 83 319 103 285 132 272 C 145 235 182 217 214 232 C 240 205 281 213 297 240 C 331 239 356 266 348 296 C 373 317 367 352 347 372 C 355 399 339 426 319 440 L 304 503 Z',INK)
stroke('M 99 390 C 88 359 102 329 128 316 C 125 286 155 265 182 273 C 196 247 227 248 242 269 C 268 253 300 268 303 294 C 327 299 337 322 327 342',INK)
stroke('M 111 343 C 131 309 153 294 178 291 C 161 312 151 335 148 359',INK)
stroke('M 132 325 C 155 293 189 278 218 282 C 191 303 180 327 176 351',INK)
stroke('M 170 296 C 196 272 231 268 257 280 C 235 296 221 317 218 340',INK)
stroke('M 219 277 C 246 263 278 276 288 299 C 269 304 252 321 246 342',INK)
stroke('M 278 285 C 301 285 319 301 319 322 M 299 315 C 315 324 322 338 317 354',INK)
stroke('M 95 378 C 79 353 91 326 108 311 M 105 302 C 111 285 130 276 146 278',INK)
# Dense, tapered hatching makes the silhouette read as dark tousled hair like the reference.
stroke('M 91 376 C 99 345 119 319 147 302',INK)
stroke('M 101 384 C 111 352 135 323 165 302',INK)
stroke('M 112 379 C 124 346 151 316 181 294',INK)
stroke('M 123 372 C 141 338 170 307 200 289',INK)
stroke('M 135 362 C 153 330 184 300 217 286',INK)
stroke('M 148 353 C 169 322 199 294 232 286',INK)
stroke('M 162 347 C 184 315 218 289 249 287',INK)
stroke('M 176 342 C 201 311 231 292 263 292',INK)
stroke('M 193 337 C 216 309 247 294 277 300',INK)
stroke('M 211 335 C 235 311 263 303 290 309',INK)
stroke('M 230 334 C 251 315 277 310 301 320',INK)
stroke('M 250 336 C 270 323 294 321 311 332',INK)
# Face, ears, sharply worried brows, open eyes, nose, and downturned mouth.
stroke('M 145 328 C 158 299 190 286 222 291 C 261 296 291 325 294 363 C 299 405 281 447 252 468 C 224 488 189 469 170 445 C 148 417 135 362 145 328 Z',INK)
stroke('M 144 366 C 126 358 112 371 117 393 C 121 410 133 418 149 413',INK)
stroke('M 168 344 C 181 333 198 332 212 339 M 244 336 C 258 329 273 334 282 344',INK)
stroke('M 174 355 C 182 350 192 352 198 358 M 249 352 C 257 348 266 350 271 357',INK)
stroke('M 183 358 C 188 363 188 370 185 376 M 257 356 C 262 361 262 368 259 374',INK)
stroke('M 222 360 C 215 378 210 391 217 396 C 222 400 229 397 233 392',INK)
stroke('M 199 428 C 214 416 236 416 253 430',INK)
stroke('M 207 439 C 219 435 231 437 240 442',GRAY)
# Neck and sweater, with the shoulder dropped toward the hand-supporting side.
stroke('M 177 457 C 180 474 175 489 163 501 M 253 463 C 254 482 263 496 278 506',INK)
stroke('M 163 501 C 125 504 99 526 83 558 C 65 596 66 653 70 714',INK)
stroke('M 278 506 C 318 513 344 537 355 576 L 388 714',INK)
stroke('M 70 714 C 153 698 224 700 290 711 C 330 717 359 719 388 714',INK)
stroke('M 301 534 C 324 543 338 560 345 582',GRAY)
stroke('M 86 598 C 106 614 119 634 123 657 M 326 575 C 339 595 344 616 345 640',GRAY)
stroke('M 91 670 C 122 660 151 658 180 663',BLUE)
# Left arm rises from the sweater; the palm and fingers visibly cradle the cheek.
stroke('M 111 542 C 128 523 145 507 157 487 C 166 470 166 448 160 429',INK)
stroke('M 160 429 C 146 416 138 399 135 381 L 128 350 C 126 338 116 333 108 341 C 100 350 108 373 109 386 L 95 365 C 87 354 76 360 78 372 L 94 407 C 83 397 72 402 76 414 L 99 450 C 110 467 126 478 146 481',INK)
stroke('M 150 424 C 139 428 127 435 119 447 M 142 443 C 132 448 124 456 120 465',GRAY)
stroke('M 112 375 C 119 388 126 400 137 408 M 100 407 C 110 417 119 423 129 427',INK)
# A few short loose hair and sweater marks retain the hand-drawn feel.
stroke('M 83 344 C 77 357 78 369 84 380 M 333 360 C 342 373 341 386 336 397',GRAY)
stroke('M 284 519 C 297 523 307 530 314 539',INK)

# Split any grouped moves into pen-up strokes and sample each curve once.
import re
STROKES=[(p.strip(),c) for d,c in RAW for p in re.split(r'(?=M\s)',d) if p.strip()]

def draw_rtl(draw,xy,text,font,fill,anchor='mm'):
    from arabic import draw_text
    draw_text(draw,xy,text,font,fill,anchor=anchor)

def sample_path(path):
    length=float(path.length()); n=max(2,math.ceil(length/4)); points=[]
    for i in range(n):
        dist=min(length*i/(n-1),max(0.0,length-1e-6))
        p=path.point(path.ilength(dist));points.append((round(p.real),round(p.imag)))
    return points,length

def draw_progress(draw,points,fraction,color,width):
    if fraction<=0 or len(points)<2:return
    x=min(1.0,fraction)*(len(points)-1); i=int(x); part=x-i
    line=points[:i+1]
    if i<len(points)-1 and part>0:
        a,b=points[i],points[i+1];line.append((round(a[0]+(b[0]-a[0])*part),round(a[1]+(b[1]-a[1])*part)))
    if len(line)>1:draw.line(line,fill=color,width=width,joint='curve')

def prep_hand():
    src=Image.open(HAND_REF).convert('RGB');rgb=np.asarray(src,dtype=np.uint8)
    mask=np.min(rgb,axis=2)<249;ys,xs=np.where(mask)
    box=(max(0,int(xs.min())-3),max(0,int(ys.min())-3),min(src.width,int(xs.max())+4),min(src.height,int(ys.max())+4))
    crop=src.crop(box).convert('RGBA');a=np.asarray(crop,dtype=np.uint8).copy()
    distance=255-np.min(a[:,:,:3],axis=2).astype(np.int16)
    alpha=np.clip((distance-9)*(255/24),0,255).astype(np.uint8);alpha[distance<=8]=0;a[:,:,3]=alpha
    hand=Image.fromarray(a,'RGBA');width=250;height=round(hand.height*width/hand.width)
    hand=hand.resize((width,height),Image.Resampling.LANCZOS)
    anchor=(10*width/(box[2]-box[0]),86*width/(box[2]-box[0]))
    return hand,anchor

def orient_hand(hand,anchor,tangent):
    dx,dy=tangent
    if abs(dx)+abs(dy)<1e-4:dx,dy=-1,0
    motion=math.atan2(dy,dx)
    desired_body=motion+math.pi
    body=math.atan2(hand.height*.58-anchor[1],hand.width*.58-anchor[0])
    # The reference hand keeps a stable writing pose; allow only a small wrist-angle correction.
    rotation=max(-18,min(18,math.degrees(body-desired_body)))
    rotated=hand.rotate(rotation,resample=Image.Resampling.BICUBIC,expand=True)
    r=math.radians(rotation);cx,cy=hand.width/2,hand.height/2
    ax,ay=anchor[0]-cx,anchor[1]-cy
    new_anchor=(rotated.width/2+math.cos(r)*ax+math.sin(r)*ay,
                rotated.height/2-math.sin(r)*ax+math.cos(r)*ay)
    return rotated,new_anchor

def board():
    # Match the plain white paper of the supplied first panel; no decorative frame.
    return Image.new('RGB',(W,H),(255,255,255))

def render():
    sys.path.insert(0,str(ROOT/'tools/wa'))
    from arabic import ARABIC_FONT
    title_font=ImageFont.truetype(str(ARABIC_FONT),245)
    try:title_font.set_variation_by_axes([700])
    except Exception:pass
    # Use the exact first storyboard panel as a brief reference shot, never as drawn pixels.
    ref=Image.open(REF).convert('RGB')
    hand,anchor=prep_hand()
    paths=[]
    # Draw the person first, then the thought cloud and moon, matching the panel's visual story.
    path_order=list(range(19,len(STROKES)))+list(range(7,19))+list(range(0,7))
    for i in path_order:
        raw,color=STROKES[i];p=parse_path(raw)
        # Lift the thought cloud away from the hair while keeping its trail aimed at the head.
        if 7<=i<=18:p=p.translated(complex(0,-55))
        # Keep the author's hand paths and artwork in one shared composition space.
        p=p.scaled(S);pts,length=sample_path(p);paths.append((pts,color,length))
    art_start,art_end=1.15,6.75;gap=.045
    durations=[max(.08,l/1450) for _,_,l in paths]
    factor=(art_end-art_start-gap*(len(paths)-1))/sum(durations)
    durations=[x*factor for x in durations];starts=[];cursor=art_start
    for dur in durations:starts.append(cursor);cursor+=dur+gap

    base=board();base_rgb=np.asarray(base)
    # Large, bold Arabic title sized and positioned like the uploaded first panel.
    title_specs=[('لماذا',INK,(1370,255),7.05,7.80),
                 ('نفكر كثيرًا',BLUE,(1320,485),7.83,8.82),
                 ('قبل النوم؟',INK,(1280,720),8.85,9.90)]
    title_layers=[]
    for text,color,xy,st,en in title_specs:
        layer=Image.new('RGBA',(W,H),(0,0,0,0));draw_rtl(ImageDraw.Draw(layer),xy,text,title_font,(*color,255))
        title_layers.append((layer,layer.getchannel('A').getbbox(),st,en))
    captions=[(.60,6.75,'حين يهدأ كل شيء، تظل الأفكار تدور في الرأس.'),(7.05,10.35,'لماذا نفكر كثيرًا قبل النوم؟')]
    caption_font=ImageFont.truetype(str(ARABIC_FONT),50)
    # Preserve the supplied panel's proportions when it appears as the opening reference.
    intro=Image.new('RGB',(W,H),(255,255,255))
    ref_h=H;ref_w=round(ref.width*ref_h/ref.height)
    ri=ref.resize((ref_w,ref_h),Image.Resampling.LANCZOS)
    intro.paste(ri,((W-ref_w)//2,0))
    intro_rgb=np.asarray(intro)
    hand_anchor=anchor
    ffmpeg=subprocess.check_output([sys.executable,'-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],text=True).strip()
    OUT.parent.mkdir(parents=True,exist_ok=True)
    # Store Arabic subtitle timings as a sidecar SRT file.
    srt=[]
    for i,(a,b,text) in enumerate(captions,1):
        def ts(t):
            ms=round(t*1000);h,ms=divmod(ms,3600000);m,ms=divmod(ms,60000);s,ms=divmod(ms,1000)
            return f'{h:02}:{m:02}:{s:02},{ms:03}'
        srt.extend([str(i),f'{ts(a)} --> {ts(b)}',text,''])
    SRT.write_text('\n'.join(srt),encoding='utf-8')
    # Gentle original music bed; narration is the native generated Arabic clip.
    rate=48000;n=round(DURATION*rate);tt=np.arange(n)/rate
    music=np.zeros(n,dtype=np.float64)
    chord=(174.61,220.0,261.63,329.63)
    for f in chord:music+=np.sin(2*np.pi*f*tt)
    music*=0.014/len(chord)
    music*=np.minimum(1,tt/.5)*np.minimum(1,(DURATION-tt)/.7)
    music_wav=ROOT/'build/audio/overthinking_music.wav';music_wav.parent.mkdir(parents=True,exist_ok=True)
    with wave.open(str(music_wav),'wb') as w:
        stereo=np.repeat(music[:,None],2,axis=1)
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate);w.writeframes(np.clip(stereo*32767,-32768,32767).astype('<i2').tobytes())
    cmd=[ffmpeg,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(VOICE_ART),'-i',str(VOICE_TITLE),'-i',str(music_wav),'-filter_complex','[1:a]aresample=48000,adelay=600|600,volume=1.0[a1];[2:a]aresample=48000,adelay=7000|7000,volume=1.0[a2];[3:a]volume=0.9[m];[a1][a2][m]amix=inputs=3:duration=longest:normalize=0[a]','-map','0:v','-map','[a]','-t',str(DURATION),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(OUT)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    frames=round(DURATION*FPS)
    for fi in range(frames):
        t=fi/FPS
        pos=None;tangent=(-1,0);show_hand=False
        if t<.72:
            frame=Image.fromarray(intro_rgb)
        elif t<1.08:
            frame=Image.blend(Image.fromarray(intro_rgb),Image.fromarray(base_rgb),(t-.72)/.36)
        else:
            frame=base.copy()
            # The drawing appears first: the person, then the thought cloud and moon.
            if t>=art_start:
                for j,(pts,color,length) in enumerate(paths):
                    st=starts[j];en=st+durations[j]
                    if t>=en:
                        draw_progress(ImageDraw.Draw(frame),pts,1,color,max(2,round(4.3*S)))
                    elif t>=st:
                        q=(t-st)/durations[j]
                        draw_progress(ImageDraw.Draw(frame),pts,q,color,max(2,round(4.3*S)))
                        z=min(1,q)*(len(pts)-1);k=int(z);u=z-k;a,b=pts[k],pts[min(k+1,len(pts)-1)]
                        pos=(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u)
                        tangent=(b[0]-a[0],b[1]-a[1]);show_hand=True
                        break
                    else:
                        if j==0:pos=pts[0]
                        else:
                            a=paths[j-1][0][-1];b=pts[0]
                            q=max(0,min(1,(t-(st-gap))/gap))
                            pos=(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
                            tangent=(b[0]-a[0],b[1]-a[1])
                        show_hand=True
                        break
            # Handwrite the three title lines from right to left after the illustration is established.
            for i,(layer,bbox,st,en) in enumerate(title_layers):
                x0,y0,x1,y1=bbox
                if t>=en:
                    frame=Image.alpha_composite(frame.convert('RGBA'),layer).convert('RGB')
                elif t>=st:
                    q=max(0,min(1,(t-st)/(en-st)));cut=round(x1-q*(x1-x0))
                    reveal=Image.new('L',(W,H),0)
                    ImageDraw.Draw(reveal).rectangle((cut-2,y0-4,x1+2,y1+4),fill=255)
                    reveal=reveal.filter(ImageFilter.GaussianBlur(1.2))
                    shown=layer.copy();shown.putalpha(ImageChops.multiply(layer.getchannel('A'),reveal))
                    frame=Image.alpha_composite(frame.convert('RGBA'),shown).convert('RGB')
                    pos=(cut,(y0+y1)/2);tangent=(-1,0);show_hand=True
                    break
                else:
                    if i==0:
                        if t>=art_end:
                            a=paths[-1][0][-1];b=(x1,(y0+y1)/2)
                            q=max(0,min(1,(t-art_end)/(st-art_end)))
                            pos=(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
                            tangent=(b[0]-a[0],b[1]-a[1])
                            show_hand=True
                    else:
                        prev_box=title_layers[i-1][1];prev_end=title_layers[i-1][3]
                        q=max(0,min(1,(t-prev_end)/max(.001,st-prev_end)))
                        a=(prev_box[0],(prev_box[1]+prev_box[3])/2);b=(x1,(y0+y1)/2)
                        pos=(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
                        tangent=(b[0]-a[0],b[1]-a[1]);show_hand=True
                    break
            if show_hand and pos is not None:
                cursor,cursor_anchor=orient_hand(hand,anchor,tangent)
                rgba=frame.convert('RGBA')
                rgba.alpha_composite(cursor,(round(pos[0]-cursor_anchor[0]),round(pos[1]-cursor_anchor[1])))
                frame=rgba.convert('RGB')
        # Burn captions into the picture for legibility in ordinary players; keep the SRT sidecar too.
        for ca,cb,caption in captions:
            if ca<=t<cb:
                overlay=Image.new('RGBA',(W,H),(0,0,0,0));od=ImageDraw.Draw(overlay)
                od.rounded_rectangle((650,965,1870,1055),radius=24,fill=(23,34,44,210))
                draw_rtl(od,(1260,1010),caption,caption_font,(255,255,255,255),anchor='mm')
                frame=Image.alpha_composite(frame.convert('RGBA'),overlay).convert('RGB')
                break
        # A restrained end push-in gives the completed composition a quiet finish.
        if t>=10.2:
            zoom=1+.009*min(1,(t-10.2)/(DURATION-10.2))
            nw,nh=round(W*zoom),round(H*zoom)
            frame=frame.resize((nw,nh),Image.Resampling.LANCZOS)
            frame=frame.crop(((nw-W)//2,(nh-H)//2,(nw+W)//2,(nh+H)//2))
        proc.stdin.write(np.asarray(frame,dtype=np.uint8).tobytes())
    proc.stdin.close();err=proc.stderr.read();rc=proc.wait()
    if rc:raise RuntimeError(err.decode('utf-8','replace')[-4000:])
    print(f'Created {OUT}, {len(STROKES)} independent vector strokes, {frames} frames')

if __name__=='__main__':render()
