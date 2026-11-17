"""Create a short, authored-stroke whiteboard montage from the generated reference.

The reference is shown briefly as an editorial opener; it is NOT revealed, traced,
or used as pixels in the drawing. The illustration below is independently authored
SVG path geometry, animated by arc length, with a generated hand cursor sprite.
"""
from __future__ import annotations

import math
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from svgpathtools import parse_path

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / "preview/references/sprout_growth_reference.png"
HAND_REFERENCE = ROOT / "preview/references/whiteboard_hand_cursor_reference.png"
OUT = ROOT / "preview/whiteboard_reference_draw_test.mp4"
TEMP_WAV = ROOT / "build/reference_draw_audio.wav"
W, H, FPS, DURATION = 1920, 1080, 30, 9.5
S = 1.5
INK = (39, 49, 55)
TEAL = (40, 126, 131)
GOLD = (208, 169, 73)
MUTED = (120, 132, 138)

# Each item is an independently authored pen stroke in a 1280 x 720 drawing space.
# It is a simplified redraw of the generated reference, not an image trace.
STROKES: list[tuple[str, tuple[int, int, int]]] = []
def add(d: str, color=INK): STROKES.append((d, color))

# Gardener: hat, face, features, neck, coat, apron, and an open presenting arm.
add('M 258 252 C 254 222 264 195 293 183 C 324 170 361 177 378 196 L 392 227')
add('M 239 258 C 267 235 318 222 369 228 C 390 231 411 241 423 253 C 393 273 348 282 301 278 C 274 276 251 269 239 258 Z')
add('M 252 256 C 296 240 355 235 408 250', TEAL)
add('M 282 264 C 282 240 290 220 310 211 C 332 202 356 208 369 226 C 381 244 378 276 365 294 C 353 313 329 321 309 309 C 290 298 282 283 282 264 Z')
add('M 286 249 C 294 228 316 218 338 221 C 355 223 369 234 375 249')
add('M 295 267 C 301 263 307 263 312 266')
add('M 340 264 C 345 261 351 262 355 265')
add('M 303 275 C 303 279 303 282 306 283')
add('M 322 277 C 328 282 336 281 340 276')
add('M 317 294 C 327 301 342 300 350 291')
add('M 296 308 C 297 322 292 331 283 337')
add('M 343 312 C 345 324 350 331 360 337')
add('M 283 337 C 259 344 240 355 228 375 C 217 398 218 438 225 472 L 238 520 C 242 533 252 539 267 539 L 369 539 C 386 538 395 527 395 511 L 392 416 C 391 381 381 354 360 337')
add('M 283 340 C 294 361 307 378 323 387 L 343 362 L 360 340', TEAL)
add('M 266 353 C 279 384 289 414 292 449 L 295 520')
add('M 376 356 C 384 387 384 423 381 456')
add('M 265 371 C 243 391 238 418 243 450')
# Left arm bent down; right sleeve and long presenting arm with open hand.
add('M 230 379 C 211 400 206 430 214 455 L 229 481 C 238 494 251 490 259 481')
add('M 357 354 C 382 361 397 377 408 394 C 419 410 433 416 452 410')
add('M 452 410 C 473 398 482 384 497 380 C 515 376 531 382 547 379 C 561 377 569 369 582 366 C 594 364 599 370 591 379 L 578 390 C 598 386 612 382 625 384 C 639 386 639 393 628 398 L 610 404 C 628 401 640 402 644 408 C 648 414 639 419 626 421 L 609 424 C 622 424 627 430 621 435 C 611 443 588 444 567 440 C 541 436 521 439 501 445 C 482 450 465 447 449 438')
add('M 409 396 C 420 419 423 442 416 459 C 410 472 398 475 389 464')
add('M 477 405 C 484 397 492 392 500 390', TEAL)
add('M 581 390 L 600 387 M 611 404 L 629 400 M 610 424 L 628 423')
# Apron bib and pocket.
add('M 265 386 C 285 402 302 409 323 408 C 344 406 358 398 375 382 L 371 509 C 343 522 300 522 271 510 Z', TEAL)
add('M 294 454 C 314 460 336 460 354 453 L 354 485 C 335 491 312 491 294 485 Z', GOLD)
add('M 251 539 C 247 553 239 566 226 579 L 254 580 C 264 569 269 553 269 539')
add('M 365 539 C 367 555 374 569 388 579 L 359 580 C 350 567 348 553 349 539')
add('M 226 579 L 259 579 M 357 580 L 392 580')
# Ground and a gentle visual link from the presenter toward the plant.
add('M 175 586 C 280 592 379 592 474 587', MUTED)
add('M 499 352 C 548 296 609 267 684 253', TEAL)

# Pot: rim, soil, tapered body, highlights and ground.
add('M 802 521 C 807 510 841 504 876 505 C 912 505 944 511 948 521 C 946 532 913 537 875 537 C 837 537 806 532 802 521 Z', GOLD)
add('M 808 522 C 814 529 839 532 875 532 C 911 532 936 529 943 522')
add('M 811 536 L 826 601 C 831 618 916 619 922 601 L 939 536')
add('M 826 601 C 846 613 900 615 922 601')
add('M 834 548 L 844 588', MUTED)
add('M 914 547 L 906 589', MUTED)
add('M 795 621 C 837 627 910 627 955 621', MUTED)
add('M 820 521 C 836 514 849 514 861 518 M 885 518 C 901 514 920 516 931 521', TEAL)
# Soil line then the stem, central shoot and branches.
add('M 820 524 C 849 528 907 528 932 523', INK)
add('M 875 515 C 871 491 868 468 870 443 C 872 418 885 398 891 374 C 895 357 890 337 884 319', TEAL)
add('M 870 451 C 852 434 834 419 818 399')
add('M 876 427 C 900 406 914 388 923 366')
add('M 884 376 C 867 355 858 335 857 310')
add('M 885 350 C 899 328 911 307 913 283')
# Six leaves: individual outlines and central veins, with accent color on selected veins.
add('M 820 401 C 791 402 763 390 748 365 C 776 361 805 369 820 401 Z', TEAL)
add('M 753 368 C 778 377 798 388 815 399', INK)
add('M 785 380 L 779 367 M 798 389 L 802 376')
add('M 817 401 C 789 418 759 424 736 411 C 751 389 781 384 817 401 Z', INK)
add('M 742 411 C 768 406 790 402 814 401', TEAL)
add('M 765 407 L 756 396 M 784 403 L 780 391')
add('M 901 389 C 924 367 954 363 977 377 C 963 399 934 411 901 407 C 896 402 897 395 901 389 Z', TEAL)
add('M 902 401 C 929 393 951 385 972 379', INK)
add('M 924 394 L 926 381 M 946 386 L 952 375')
add('M 910 372 C 927 343 954 332 978 341 C 966 367 941 382 910 381 Z', INK)
add('M 913 376 C 935 362 954 352 973 344', TEAL)
add('M 935 359 L 932 347 M 951 351 L 953 339')
add('M 858 319 C 829 312 810 293 808 271 C 835 268 856 284 866 309 C 866 314 863 318 858 319 Z', TEAL)
add('M 814 275 C 832 287 847 299 861 315', INK)
add('M 837 294 L 838 280 M 850 306 L 857 294')
add('M 913 291 C 914 263 933 243 957 237 C 962 266 949 289 919 301 Z', TEAL)
add('M 917 296 C 930 276 943 259 955 242', INK)
add('M 929 279 L 920 270 M 940 264 L 941 251')
# Sun and rays.
add('M 1034 220 A 25 25 0 1 1 1033.9 220 Z', GOLD)
add('M 1034 179 L 1034 166 M 1034 274 L 1034 261 M 993 220 L 980 220 M 1088 220 L 1075 220', GOLD)
add('M 1005 191 L 996 182 M 1072 258 L 1063 249 M 1063 191 L 1072 182 M 996 258 L 1005 249', GOLD)

# Split compound move commands into separate uninterrupted pen lifts.
import re
STROKES = [(part.strip(), color) for d, color in STROKES for part in re.split(r'(?=M\s)', d) if part.strip()]


def draw_rtl(draw, xy, text, font, fill):
    from arabic import draw_text
    draw_text(draw, xy, text, font, fill, anchor='mm')


def prep_hand() -> tuple[Image.Image, tuple[float, float]]:
    src = Image.open(HAND_REFERENCE).convert('RGB')
    rgb = np.asarray(src, dtype=np.uint8)
    mask = np.min(rgb, axis=2) < 249
    ys, xs = np.where(mask)
    box = (max(0, int(xs.min())-3), max(0, int(ys.min())-3), min(src.width, int(xs.max())+4), min(src.height, int(ys.max())+4))
    crop = src.crop(box).convert('RGBA')
    a = np.asarray(crop, dtype=np.uint8).copy()
    # Chroma-key only near-white pixels, with a soft edge; skin, marker and pen remain intact.
    distance = 255 - np.min(a[:,:,:3], axis=2).astype(np.int16)
    alpha = np.clip((distance - 9) * (255/24), 0, 255).astype(np.uint8)
    alpha[distance <= 8] = 0
    a[:,:,3] = alpha
    rgba = Image.fromarray(a, 'RGBA')
    width = 330
    height = round(rgba.height * width / rgba.width)
    rgba = rgba.resize((width,height),Image.Resampling.LANCZOS)
    # Marker nib is at approximately (x=10,y=86) in the cropped source.
    anchor = (10*width/(box[2]-box[0]), 86*width/(box[2]-box[0]))
    return rgba, anchor


def make_board(title_font, sub_font):
    im = Image.new('RGB',(W,H),(249,249,247))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((45,35,W-45,H-35),radius=34,fill=(226,230,227))
    d.rounded_rectangle((52,42,W-52,H-42),radius=30,fill='white',outline=(231,235,232),width=2)
    draw_rtl(d,(W//2,130),'من بذرةٍ إلى أثر',title_font,INK)
    d.rounded_rectangle((W//2-100,164,W//2+100,172),radius=4,fill=GOLD)
    draw_rtl(d,(W//2,202),'كلُّ نموٍّ يبدأ برعاية',sub_font,MUTED)
    return im


def sample_path(path):
    length=float(path.length())
    n=max(2,math.ceil(length/4))
    pts=[]
    for i in range(n):
        distance=min(length*i/(n-1),max(0.0,length-1e-6))
        p=path.point(path.ilength(distance))
        pts.append((round(p.real),round(p.imag)))
    return pts,length

def draw_path(d: ImageDraw.ImageDraw, pts, fraction: float, color, width: int):
    if len(pts)<2 or fraction<=0: return
    fraction=min(1.0,fraction)
    position=fraction*(len(pts)-1)
    whole=int(position)
    partial=position-whole
    drawn=pts[:whole+1]
    if whole<len(pts)-1 and partial>0:
        a,b=pts[whole],pts[whole+1]
        drawn.append((round(a[0]+(b[0]-a[0])*partial),round(a[1]+(b[1]-a[1])*partial)))
    elif whole==0 and not partial:
        drawn=pts[:2]
    if len(drawn)>1: d.line(drawn,fill=color,width=width,joint='curve')


def audio_bed(path: Path):
    rate=48000; n=round(DURATION*rate); t=np.arange(n)/rate
    chords=[(196.00,246.94,293.66),(174.61,220.00,261.63),(220.00,261.63,329.63),(196.00,246.94,293.66)]
    music=np.zeros(n,dtype=np.float64)
    for i,chord in enumerate(chords):
        sel=(t>=i*2.5)&(t<(i+1)*2.5)
        local=t[sel]-i*2.5
        env=np.minimum(1,local/0.35)*np.minimum(1,(2.5-local)/0.45)
        part=np.zeros_like(local)
        for f in chord: part += np.sin(2*np.pi*f*local)
        music[sel] = .035 * part/3 * env
    # Soft marker-like ticks at scene drawing beats; original synthesized tones.
    for when in [1.78,2.62,3.48,4.32,5.18,6.02,6.88,7.72,8.55]:
        i0=round(when*rate); count=round(.11*rate); x=np.arange(count)/rate
        tone=.014*np.sin(2*np.pi*1250*x)*np.exp(-x*36)
        music[i0:min(n,i0+count)] += tone[:max(0,min(n-i0,count))]
    fade=np.minimum(1,t/.3)*np.minimum(1,(DURATION-t)/.5)
    music*=fade
    stereo=np.stack([music,music],axis=1)
    with wave.open(str(path),'wb') as w:
        w.setnchannels(2);w.setsampwidth(2);w.setframerate(rate)
        w.writeframes(np.clip(stereo*32767,-32768,32767).astype('<i2').tobytes())


def main():
    sys.path.insert(0,str(ROOT/'tools/wa'))
    from arabic import ARABIC_FONT
    title_font=ImageFont.truetype(str(ARABIC_FONT),54)
    sub_font=ImageFont.truetype(str(ARABIC_FONT),30)
    ffmpeg=subprocess.check_output([sys.executable,'-c','import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'],text=True).strip()
    OUT.parent.mkdir(parents=True,exist_ok=True); TEMP_WAV.parent.mkdir(parents=True,exist_ok=True)
    reference=Image.open(REFERENCE).convert('RGB')
    hand,anchor=prep_hand()
    paths=[]
    for raw,color in STROKES:
        p=parse_path(raw).scaled(S)
        points,length=sample_path(p)
        paths.append((points,color,length))
    # Allocate a short, comfortable gap between strokes and normalize to the draw window.
    draw_start,draw_end=1.75,8.9
    gap=.035
    durations=[max(.075,l/1550) for _,_,l in paths]
    factor=(draw_end-draw_start-gap*(len(paths)-1))/sum(durations)
    durations=[x*factor for x in durations]
    starts=[]; cursor=draw_start
    for dur in durations:
        starts.append(cursor);cursor+=dur+gap
    base=make_board(title_font,sub_font)
    base_rgb=np.asarray(base)
    ref=Image.new('RGB',(W,H),(248,248,246))
    scale=min((W-150)/reference.width,(H-190)/reference.height)
    rsz=reference.resize((round(reference.width*scale),round(reference.height*scale)),Image.Resampling.LANCZOS)
    ref.paste(rsz,((W-rsz.width)//2,(H-rsz.height)//2+10))
    rd=ImageDraw.Draw(ref)
    rd.rounded_rectangle((60,48,W-60,H-48),radius=30,outline=(227,230,228),width=3)
    rd.rounded_rectangle((90,72,388,122),radius=23,fill=(239,247,245))
    draw_rtl(rd,(239,97),'الصورة المرجعية',sub_font,TEAL)
    ref_rgb=np.asarray(ref)
    hand_w,hand_h=hand.size
    audio_bed(TEMP_WAV)
    cmd=[ffmpeg,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(TEMP_WAV),'-t',str(DURATION),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart',str(OUT)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    frames=round(FPS*DURATION)
    for fi in range(frames):
        t=fi/FPS
        if t<1.15:
            zoom=1+.012*t
            frame=Image.fromarray(ref_rgb).resize((round(W*zoom),round(H*zoom)),Image.Resampling.LANCZOS).crop((round((W*zoom-W)/2),round((H*zoom-H)/2),round((W*zoom+W)/2),round((H*zoom+H)/2)))
        elif t<1.75:
            q=(t-1.15)/.60
            # A brisk editorial dissolve from the actual generated reference to the clean board.
            frame=Image.blend(Image.fromarray(ref_rgb),base,q)
        else:
            frame=base.copy(); d=ImageDraw.Draw(frame); active=None; hand_pos=None
            for j,(pts,color,length) in enumerate(paths):
                st=starts[j]; en=st+durations[j]
                if t>=en:
                    draw_path(d,pts,1,color,max(2,round(4.2*S)))
                elif t>=st:
                    q=(t-st)/durations[j]
                    draw_path(d,pts,q,color,max(2,round(4.2*S)))
                    active=j
                    pos=min(1.0,q)*(len(pts)-1); whole=int(pos); partial=pos-whole
                    a=pts[whole]; b=pts[min(whole+1,len(pts)-1)]
                    hand_pos=(a[0]+(b[0]-a[0])*partial,a[1]+(b[1]-a[1])*partial)
                    break
                else:
                    # Cursor travels to the next authored stroke rather than jumping.
                    if j==0:
                        hand_pos=pts[0]
                    else:
                        prev=paths[j-1][0][-1]; nxt=pts[0]
                        move_start=starts[j]-gap
                        q=max(0,min(1,(t-move_start)/gap))
                        hand_pos=(prev[0]+(nxt[0]-prev[0])*q,prev[1]+(nxt[1]-prev[1])*q)
                    break
            if hand_pos is not None and t<draw_end:
                x=round(hand_pos[0]-anchor[0]);y=round(hand_pos[1]-anchor[1])
                frame_rgba=frame.convert('RGBA'); frame_rgba.alpha_composite(hand,(x,y));frame=frame_rgba.convert('RGB')
            # Keep the end card clean and hold the completed line drawing for review.
        proc.stdin.write(np.asarray(frame,dtype=np.uint8).tobytes())
    proc.stdin.close();err=proc.stderr.read();rc=proc.wait()
    if rc: raise RuntimeError(err.decode('utf-8','replace')[-4000:])
    print(f'Wrote {OUT} ({OUT.stat().st_size} bytes), {len(STROKES)} authored strokes, {frames} frames')

if __name__=='__main__': main()
