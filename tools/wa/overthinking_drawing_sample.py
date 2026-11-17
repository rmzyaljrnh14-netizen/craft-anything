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
stroke('M 245 253 C 261 271 282 243 301 259 C 316 272 302 292 283 288 C 266 285 260 269 271 257 C 286 240 312 253 322 270',INK)
stroke('M 250 276 C 268 261 277 234 300 231 C 324 229 337 252 324 268 C 313 281 293 273 297 258 C 301 245 321 243 334 253',INK)
stroke('M 239 244 C 255 230 273 238 279 252 C 284 267 301 267 312 253 C 323 239 340 246 343 260',INK)
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
stroke('M 214 495 C 191 499 175 510 164 529 C 148 557 147 606 150 681',INK)
stroke('M 288 493 C 315 502 329 520 335 548 L 348 630 L 367 688',INK)
stroke('M 150 681 C 196 669 235 668 274 677 C 303 684 329 691 367 688',INK)
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

def board():
    # Match the plain white paper of the supplied first panel; no decorative frame.
    return Image.new('RGB',(W,H),(255,255,255))

def render():
    sys.path.insert(0,str(ROOT/'tools/wa'))
    from arabic import ARABIC_FONT
    title_font=ImageFont.truetype(str(ARABIC_FONT),220)
    try:title_font.set_variation_by_axes([700])
    except Exception:pass
    # Use the exact first storyboard panel as a brief reference shot, never as drawn pixels.
    ref=Image.open(REF).convert('RGB')
    hand,anchor=prep_hand()
    paths=[]
    for i,(raw,color) in enumerate(STROKES):
        p=parse_path(raw)
        if i<=6:
            p=p.translated(complex(0,-110))
        elif i<=18:
            p=p.scaled(1.8,1.45,origin=complex(300,260)).translated(complex(0,-45))
        elif i<=35:
            p=p.scaled(1.8,1.25,origin=complex(260,350))
        else:
            p=p.scaled(1.8,1.0,origin=complex(260,500))
        p=p.scaled(S);pts,length=sample_path(p);paths.append((pts,color,length))
    art_start,draw_end=3.95,9.85;gap=.035
    durations=[max(.08,l/1450) for _,_,l in paths]
    factor=(draw_end-art_start-gap*(len(paths)-1))/sum(durations)
    durations=[x*factor for x in durations];starts=[];cursor=art_start
    for dur in durations:starts.append(cursor);cursor+=dur+gap

    base=board();base_rgb=np.asarray(base)
    # Large, bold Arabic title sized and positioned like the uploaded first panel.
    title_specs=[('لماذا',INK,(1370,255),1.15,1.82),
                 ('نفكر كثيرًا',BLUE,(1320,485),1.84,2.78),
                 ('قبل النوم؟',INK,(1280,720),2.80,3.78)]
    title_layers=[]
    for text,color,xy,st,en in title_specs:
        layer=Image.new('RGBA',(W,H),(0,0,0,0));draw_rtl(ImageDraw.Draw(layer),xy,text,title_font,(*color,255))
        title_layers.append((layer,layer.getchannel('A').getbbox(),st,en))
    captions=[(.55,3.78,'لماذا نفكر كثيرًا قبل النوم؟'),(3.78,7.0,'حين يهدأ كل شيء، يبدأ العقل بمراجعة اليوم.'),(7.0,10.25,'ويظل يقفز بين الأمس والغد.')]
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
    cmd=[ffmpeg,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(VOICE),'-i',str(music_wav),'-filter_complex','[1:a]aresample=48000,adelay=550|550,volume=1.0[v];[2:a]volume=0.9[m];[v][m]amix=inputs=2:duration=longest:normalize=0[a]','-map','0:v','-map','[a]','-t',str(DURATION),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(OUT)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    frames=round(DURATION*FPS)
    for fi in range(frames):
        t=fi/FPS
        if t<.72:
            frame=Image.fromarray(intro_rgb)
        elif t<1.08:
            frame=Image.blend(Image.fromarray(intro_rgb),Image.fromarray(base_rgb),(t-.72)/.36)
        else:
            frame=base.copy();pos=None;active_title=False
            # Title glyphs write in sequence from right to left, with the cursor at the reveal edge.
            for i,(layer,bbox,st,en) in enumerate(title_layers):
                x0,y0,x1,y1=bbox
                if t>=en:
                    frame=Image.alpha_composite(frame.convert('RGBA'),layer).convert('RGB')
                elif t>=st:
                    q=max(0,min(1,(t-st)/(en-st)))
                    reveal=Image.new('L',(W,H),0)
                    cut=round(x1-q*(x1-x0))
                    ImageDraw.Draw(reveal).rectangle((cut-2,y0-4,x1+2,y1+4),fill=255)
                    reveal=reveal.filter(ImageFilter.GaussianBlur(1.2))
                    shown=layer.copy();shown.putalpha(ImageChops.multiply(layer.getchannel('A'),reveal))
                    frame=Image.alpha_composite(frame.convert('RGBA'),shown).convert('RGB')
                    pos=(cut,(y0+y1)/2);active_title=True
                    break
                else:
                    if i==0:
                        pos=(x1,(y0+y1)/2)
                    else:
                        prev_box=title_layers[i-1][1];prev_end=title_layers[i-1][3]
                        q=max(0,min(1,(t-prev_end)/max(.001,st-prev_end)))
                        pos=(prev_box[0]+(x1-prev_box[0])*q,
                             (prev_box[1]+prev_box[3])/2+((y0+y1)/2-(prev_box[1]+prev_box[3])/2)*q)
                    active_title=True
                    break
            # After the final word, the hand lifts and travels to the illustrated moon.
            if not active_title and t<art_start:
                b=title_layers[-1][1];a=(b[0],(b[1]+b[3])/2);z=paths[0][0][0]
                q=max(0,min(1,(t-title_layers[-1][3])/(art_start-title_layers[-1][3])))
                pos=(a[0]+(z[0]-a[0])*q,a[1]+(z[1]-a[1])*q)
            # Draw moon, thought cloud, restless scribble and worried person as progressive SVG paths.
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
                        break
                    else:
                        if j==0:pos=pts[0]
                        else:
                            a=paths[j-1][0][-1];b=pts[0];q=max(0,min(1,(t-(st-gap))/gap));pos=(a[0]+(b[0]-a[0])*q,a[1]+(b[1]-a[1])*q)
                        break
            if pos is not None and (active_title or t<draw_end+.03):
                x=round(pos[0]-anchor[0]);y=round(pos[1]-anchor[1])
                rgba=frame.convert('RGBA');rgba.alpha_composite(hand,(x,y));frame=rgba.convert('RGB')
        # A restrained end push-in keeps the finished frame alive without obscuring the drawing.
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
