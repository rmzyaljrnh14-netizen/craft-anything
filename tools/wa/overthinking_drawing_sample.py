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
from PIL import Image, ImageDraw, ImageFont
from svgpathtools import parse_path

ROOT=Path(__file__).resolve().parents[2]
PREVIEW=ROOT/'preview'
REF=PREVIEW/'references/overthinking_panel_00.png'
HAND_REF=PREVIEW/'references/whiteboard_hand_cursor_reference.png'
VOICE=PREVIEW/'references/overthinking_voiceover.wav'
OUT=PREVIEW/'overthinking_drawing_sample.mp4'
SRT=PREVIEW/'overthinking_drawing_sample.srt'
W,H,FPS,DURATION=1920,1080,30,11.5
S=1.5
INK=(29,36,42); BLUE=(24,96,184); TEAL=(25,140,154); GOLD=(224,171,46); GRAY=(112,123,131); PALE=(232,240,245)

# Original vector redraw based on the first 0:00–0:10 storyboard panel.
# Coordinates use a 1280x720 artboard, then scale to full-HD.
RAW=[]
def stroke(d,color=INK):RAW.append((d,color))
# Night cues and thought-cloud. Pen lifts are independent strokes.
stroke('M 642 196 C 610 202 593 234 604 264 C 616 297 657 304 680 283 C 662 286 644 278 635 261 C 622 237 629 213 642 196 Z',BLUE)
stroke('M 669 219 L 680 214 M 682 244 L 693 245 M 666 270 L 673 278',BLUE)
stroke('M 696 191 L 704 182 M 709 218 L 721 218 M 699 245 L 706 252',GRAY)
# Cloud drawn as a single continuous contour, with three trailing thought bubbles.
stroke('M 205 300 C 181 291 177 262 195 245 C 187 220 205 196 231 197 C 244 171 276 166 296 183 C 319 159 354 165 366 191 C 394 184 414 206 408 231 C 433 244 434 276 412 291 C 397 310 371 311 349 304 C 328 322 298 320 282 305 C 260 321 229 317 218 302 C 213 302 209 301 205 300 Z',INK)
stroke('M 359 314 C 367 319 370 326 367 331',INK)
stroke('M 382 334 C 388 341 387 348 382 351',INK)
stroke('M 397 361 C 402 367 401 373 396 377',INK)
# Restless thought scribble: one organic looping stroke, not a pasted raster.
stroke('M 232 247 C 245 214 283 207 309 226 C 330 243 324 270 297 280 C 275 289 249 278 252 257 C 255 239 286 231 305 244 C 323 257 311 278 291 278 C 273 278 264 264 274 252 C 286 238 306 242 312 255 C 319 273 298 287 278 284 C 252 281 238 262 249 242 C 263 218 298 219 321 238 C 341 255 334 282 311 291 C 281 303 245 291 239 269 C 235 259 235 252 232 247 Z',INK)
stroke('M 219 223 L 211 215 M 213 273 L 202 276 M 390 211 L 400 205 M 414 269 L 425 273',GRAY)
# Worried young person: hair silhouette and loose curls.
stroke('M 184 448 C 165 430 166 398 181 379 C 177 352 190 328 215 320 C 232 300 264 303 280 318 C 308 312 331 331 329 355 C 346 372 338 397 322 410 C 318 432 305 449 289 456 L 202 464 Z',INK)
stroke('M 183 406 C 171 386 185 361 201 354 C 198 334 220 321 238 329 C 249 309 274 317 282 336 C 303 330 321 345 316 363',INK)
stroke('M 188 378 C 198 361 205 351 218 347 M 211 340 C 224 327 239 326 248 330 M 256 324 C 274 321 288 332 292 344 M 301 342 C 312 349 316 361 314 371',INK)
# Face, ears, brows, eyes, nose and worried mouth.
stroke('M 205 374 C 214 354 238 347 263 351 C 289 355 307 374 307 400 C 308 428 294 454 273 466 C 253 477 227 465 213 447 C 202 432 197 397 205 374 Z',INK)
stroke('M 198 394 C 187 390 181 399 184 411 C 186 422 194 425 202 420',INK)
stroke('M 220 387 C 229 380 238 380 246 385 M 272 383 C 281 378 290 381 296 387',INK)
stroke('M 224 394 C 229 391 234 392 237 396 M 278 393 C 282 391 287 393 289 397',INK)
stroke('M 258 395 C 254 408 250 418 255 422 C 259 425 265 423 267 420',INK)
stroke('M 237 442 C 249 432 266 431 279 438',INK)
stroke('M 239 450 C 250 447 261 447 271 450',TEAL)
# Neck, shoulders, sweater and bent arm supporting the cheek.
stroke('M 226 462 C 229 477 225 487 215 495 M 270 463 C 270 478 277 487 288 493',INK)
stroke('M 214 495 C 191 499 175 510 164 529 C 148 557 147 592 150 625',INK)
stroke('M 288 493 C 315 502 329 520 335 548 L 348 598 L 367 625',INK)
stroke('M 150 625 C 196 615 235 614 274 620 C 303 625 329 628 367 625',INK)
stroke('M 207 500 C 205 521 210 542 224 557 C 236 571 249 580 262 591',BLUE)
# Raised arm and hand touching cheek: wrist enters from lower-left, fingertips meet face.
stroke('M 163 534 C 179 521 190 511 197 495 C 202 480 200 463 207 450',INK)
stroke('M 207 450 C 213 438 222 435 228 441 C 232 446 228 454 224 460 C 222 466 228 467 233 462 C 240 455 246 455 250 460 C 253 465 249 471 244 477 C 251 473 257 475 258 480 C 259 485 253 490 246 495 C 238 502 230 511 225 523',INK)
stroke('M 194 520 C 203 512 213 507 224 505 M 184 532 C 193 527 202 524 211 523',GRAY)
stroke('M 183 401 C 188 405 190 411 188 417 M 195 434 C 198 441 202 445 208 447',INK)
# Small clothing seams and loose shoulder detail.
stroke('M 154 552 C 169 564 178 578 182 594 M 313 525 C 321 540 324 556 325 572',GRAY)
stroke('M 157 602 C 180 595 193 594 207 598',BLUE)

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
    hand=Image.fromarray(a,'RGBA');width=330;height=round(hand.height*width/hand.width)
    hand=hand.resize((width,height),Image.Resampling.LANCZOS)
    anchor=(10*width/(box[2]-box[0]),86*width/(box[2]-box[0]))
    return hand,anchor

def board(title_font,small_font):
    im=Image.new('RGB',(W,H),(250,250,248));d=ImageDraw.Draw(im)
    d.rounded_rectangle((47,38,W-47,H-38),radius=30,fill=(232,235,233))
    d.rounded_rectangle((54,45,W-54,H-45),radius=27,fill='white',outline=(229,233,231),width=2)
    # Small chapter marker at top right.
    d.rounded_rectangle((W-490,88,W-126,142),radius=27,fill=(238,246,249))
    draw_rtl(d,(W-308,115),'قبل النوم | أفكار لا تهدأ',small_font,BLUE)
    return im

def render():
    sys.path.insert(0,str(ROOT/'tools/wa'))
    from arabic import ARABIC_FONT
    title_font=ImageFont.truetype(str(ARABIC_FONT),104)
    small_font=ImageFont.truetype(str(ARABIC_FONT),31)
    caption_font=ImageFont.truetype(str(ARABIC_FONT),35)
    # Check reference crop is intact and marked as the user's source storyboard.
    ref=Image.open(REF).convert('RGB')
    hand,anchor=prep_hand()
    paths=[]
    for raw,color in STROKES:
        p=parse_path(raw).scaled(S);pts,length=sample_path(p);paths.append((pts,color,length))
    start,draw_end=1.2,9.85;gap=.035
    durations=[max(.08,l/1450) for _,_,l in paths]
    factor=(draw_end-start-gap*(len(paths)-1))/sum(durations)
    durations=[x*factor for x in durations];starts=[];cursor=start
    for dur in durations:starts.append(cursor);cursor+=dur+gap

    base=board(title_font,small_font)
    # Captions are composed as shaped Arabic text, not rasterized from the supplied frame.
    captions=[(.55,3.7,'لماذا نفكر كثيرًا قبل النوم؟'),(3.7,6.9,'حين يهدأ كل شيء، يبدأ العقل بمراجعة اليوم.'),(6.9,10.25,'ويظل يقفز بين الأمس والغد.')]
    # Reference intro card with light border; it is not used in the drawing pipeline.
    intro=Image.new('RGB',(W,H),(246,247,245));idraw=ImageDraw.Draw(intro)
    idraw.rounded_rectangle((70,55,W-70,H-55),radius=28,fill='white',outline=(222,226,224),width=3)
    scale=min((W-160)/ref.width,(H-170)/ref.height)
    ri=ref.resize((round(ref.width*scale),round(ref.height*scale)),Image.Resampling.LANCZOS)
    intro.paste(ri,((W-ri.width)//2,(H-ri.height)//2))
    idraw.rounded_rectangle((W-465,75,W-100,132),radius=25,fill=(238,246,249))
    draw_rtl(idraw,(W-282,103),'مرجعك: المشهد الأول',small_font,BLUE)
    intro_rgb=np.asarray(intro);base_rgb=np.asarray(base)
    # Use a real generated pen-in-hand cutout, chroma-keyed to transparency, anchored at the nib.
    hand_anchor=anchor
    ffmpeg=subprocess.check_output([sys.executable,'-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],text=True).strip()
    OUT.parent.mkdir(parents=True,exist_ok=True)
    # Store Arabic subtitle timings alongside the rendered, burned-in captions.
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
    cmd=[ffmpeg,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(VOICE),'-i',str(music_wav),'-filter_complex','[1:a]aresample=48000,adelay=550|550,volume=1.0[v];[2:a]volume=0.9[m];[v][m]amix=inputs=2:duration=longest:normalize=0[a]','-map','0:v','-map','[a]','-t',str(DURATION),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(OUT)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    frames=round(DURATION*FPS)
    for fi in range(frames):
        t=fi/FPS
        if t<.75:
            frame=Image.fromarray(intro_rgb)
        elif t<1.2:
            frame=Image.blend(Image.fromarray(intro_rgb),Image.fromarray(base_rgb),(t-.75)/.45)
        else:
            frame=base.copy();draw=ImageDraw.Draw(frame);pos=None
            # Write the title in three visual beats while the illustration draws.
            title_a=max(0,min(1,(t-1.2)/.45))
            title_b=max(0,min(1,(t-1.85)/.50))
            title_c=max(0,min(1,(t-2.45)/.50))
            layer=Image.new('RGBA',(W,H),(0,0,0,0));ld=ImageDraw.Draw(layer)
            # Full separate title lines, faded in by word rather than revealing a source bitmap.
            if title_a>0:
                l=Image.new('RGBA',(W,H),(0,0,0,0));ImageDraw.Draw(l).text((0,0),'',fill=(0,0,0,0))
                # Recompose the matching line with its own alpha so beats are independently timed.
                draw_rtl(ImageDraw.Draw(l),(1260,345),'لماذا',title_font,(*INK,round(255*title_a)))
                layer=Image.alpha_composite(layer,l)
            if title_b>0:
                l=Image.new('RGBA',(W,H),(0,0,0,0));draw_rtl(ImageDraw.Draw(l),(1260,475),'نفكر كثيرًا',title_font,(*BLUE,round(255*title_b)));layer=Image.alpha_composite(layer,l)
            if title_c>0:
                l=Image.new('RGBA',(W,H),(0,0,0,0));draw_rtl(ImageDraw.Draw(l),(1260,605),'قبل النوم؟',title_font,(*INK,round(255*title_c)));ImageDraw.Draw(l).rounded_rectangle((890,674,1630,682),radius=4,fill=(*GOLD,round(255*title_c)));layer=Image.alpha_composite(layer,l)
            frame=Image.alpha_composite(frame.convert('RGBA'),layer).convert('RGB')
            draw=ImageDraw.Draw(frame)
            # Figure/brain/moon strokes draw progressively; hand follows the active tip.
            for j,(pts,color,length) in enumerate(paths):
                st=starts[j];en=st+durations[j]
                if t>=en:draw_progress(draw,pts,1,color,max(2,round(4.0*S)))
                elif t>=st:
                    q=(t-st)/durations[j];draw_progress(draw,pts,q,color,max(2,round(4.0*S)))
                    z=min(1,q)*(len(pts)-1);k=int(z);u=z-k;a,b=pts[k],pts[min(k+1,len(pts)-1)]
                    pos=(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u)
                    break
                else:
                    if j==0:pos=pts[0]
                    else:
                        a=paths[j-1][0][-1];b=pts[0];q=max(0,min(1,(t-(st-gap))/gap));pos=(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
                    break
            if pos is not None and t<draw_end+0.03:
                x=round(pos[0]-hand_anchor[0]);y=round(pos[1]-hand_anchor[1])
                rgba=frame.convert('RGBA');rgba.alpha_composite(hand,(x,y));frame=rgba.convert('RGB')
            # Arabic timed captions, distinct from the authored illustration strokes.
            cue=next((c for c in captions if c[0]<=t<c[1]),None)
            if cue:
                d=ImageDraw.Draw(frame);d.rounded_rectangle((680,904,1780,982),radius=22,fill=(248,250,250),outline=(231,236,236),width=2)
                draw_rtl(d,(1230,943),cue[2],caption_font,INK)
        if t>=10.2:
            zoom=1+.012*min(1,(t-10.2)/(DURATION-10.2))
            nw,nh=round(W*zoom),round(H*zoom)
            frame=frame.resize((nw,nh),Image.Resampling.LANCZOS)
            frame=frame.crop(((nw-W)//2,(nh-H)//2,(nw+W)//2,(nh+H)//2))
        proc.stdin.write(np.asarray(frame,dtype=np.uint8).tobytes())
    proc.stdin.close();err=proc.stderr.read();rc=proc.wait()
    if rc:raise RuntimeError(err.decode('utf-8','replace')[-4000:])
    print(f'Created {OUT}, {len(STROKES)} independent vector strokes, {frames} frames')

if __name__=='__main__':render()
