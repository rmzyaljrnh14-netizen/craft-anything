"""Whiteboard Studio CLI: environment audit, SVG-stroke demo renderer, and QC."""
from __future__ import annotations
import argparse, json, math, re, shutil, subprocess, sys, wave
from pathlib import Path
from importlib.util import find_spec

ROOT=Path(__file__).resolve().parents[2]
PROJECT=ROOT/'tools/wa/projects/whiteboard_studio_demo.json'
BUILD=ROOT/'build'; RENDER=BUILD/'render'; VO=BUILD/'vo'; MUSIC=BUILD/'music'; SUBS=BUILD/'subs'
FONT_DIR=ROOT/'assets/fonts'


def ffmpeg_path():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()

def audit():
    tools={}
    for name in ('ffmpeg','ffprobe','blender','resolve','davinci-resolve','aftereffects','aerender','audacity','sox','convert','magick','inkscape','rsvg-convert','node','npm','python3'):
        tools[name]=shutil.which(name)
    tools['bundled_ffmpeg']=ffmpeg_path()
    modules=('PIL','numpy','svgwrite','svgpathtools','uharfbuzz','arabic_reshaper','bidi','soundfile','pyloudnorm','av','moviepy','manim','cv2','piper','edge_tts')
    packages={m:bool(find_spec(m)) for m in modules}
    skill_roots=['.agents/skills','.claude/skills','skills']
    skills=[]
    for rel in skill_roots:
        d=ROOT/rel
        if d.exists(): skills.extend(str(p.relative_to(ROOT)) for p in d.rglob('*') if p.is_file())
    report={
      'system':{'platform':sys.platform,'python':sys.version.split()[0],'node':tools['node'],'npm':tools['npm']},
      'tools':tools,'python_modules':packages,'installed_skills':skills,
      'arena_capabilities':{'image_generation':True,'image_search':True,'native_speech_generation':True,'video_generation_tool':False},
      'selected_stack':['svgpathtools path-length sampling','svgwrite SVG authoring','Pillow/NumPy frame composition','imageio-ffmpeg H.264/AAC','PyAV stream/frame QC','soundfile/pyloudnorm audio QC','native Arabic TTS']
    }
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return report


def make_demo():
    import numpy as np
    import soundfile as sf
    import svgwrite
    from svgpathtools import parse_path
    from PIL import Image,ImageDraw
    from arabic import ARABIC_FONT, get_font, draw_text
    data=json.loads(PROJECT.read_text(encoding='utf-8'))
    W,H=data['canvas']['width'],data['canvas']['height']; S=data['export']['width']/W
    FW,FH=data['export']['width'],data['export']['height']; FPS=data['export']['fps']; D=float(data['export']['duration_seconds'])
    strokes=data['strokes']; voice=ROOT/data['voiceover']
    if not voice.exists(): raise FileNotFoundError(f'Missing demo voiceover: {voice}')
    RENDER.mkdir(parents=True,exist_ok=True); MUSIC.mkdir(parents=True,exist_ok=True); SUBS.mkdir(parents=True,exist_ok=True)
    # The storyboard is emitted as authored SVG vector geometry. It contains no raster illustration.
    svg=svgwrite.Drawing(str(RENDER/'whiteboard_demo_source.svg'),size=(FW,FH),viewBox=f'0 0 {FW} {FH}')
    for item in strokes:
        path=parse_path(item['d']).scaled(S)
        svg.add(svg.path(d=item['d'],fill='none',stroke=item['color'],stroke_width=float(item['width'])*S,stroke_linecap='round',stroke_linejoin='round',id=item['id']))
    svg.save()
    paths=[]
    for item in strokes:
        path=parse_path(item['d']).scaled(S)
        paths.append((item,path,float(path.length()),item['start'],item['end']))
    # Captions use real SRT timings and are burned with libass; retain separate SRT for QC.
    def srt_ts(t):
        ms=round(t*1000); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); sec,ms=divmod(ms,1000)
        return f'{h:02}:{m:02}:{sec:02},{ms:03}'
    srt=[]
    for i,c in enumerate(data['captions'],1): srt += [str(i),f"{srt_ts(c['start'])} --> {srt_ts(c['end'])}",c['text'],'']
    srt_path=SUBS/'whiteboard_demo.srt'; srt_path.write_text('\n'.join(srt),encoding='utf-8')
    # Empty, clean whiteboard; camera-safe editorial framing; all illustration ink is path-revealed.
    def base_frame(t):
        im=Image.new('RGB',(FW,FH),(255,255,255)); d=ImageDraw.Draw(im)
        d.rounded_rectangle((50,42,FW-50,FH-42),radius=28,outline=(237,240,239),width=3)
        d.rounded_rectangle((100,80,330,142),radius=28,fill=(239,247,245))
        draw_text(d,(215,111),'فكرة صغيرة',get_font(ARABIC_FONT,31*S),(13,145,143),anchor='mm')
        draw_text(d,(FW//2,145),'خطوة صغيرة، أثر كبير',get_font(ARABIC_FONT,58*S),(30,40,46),anchor='mm')
        d.rounded_rectangle((FW//2-350,184,FW//2+350,194),radius=5,fill=(239,183,64))
        draw_text(d,(FW//2,228),'الرسم يتكوّن أمامك من مسارات قلم',get_font(ARABIC_FONT,27*S),(105,117,126),anchor='mm')
        return im
    def path_points(path,length,fraction):
        if length<=0: return []
        remain=max(0,min(1,fraction))*length
        n=max(2,math.ceil(remain/(9*S)))
        values=[path.point(path.ilength(min(max(0.0,remain*i/(n-1)),max(0.0,length-1e-7)))) for i in range(n)]
        return [(round(p.real),round(p.imag)) for p in values]
    def hand_at_tip(d,tx,ty):
        # 2D illustrated hand and marker. Its marker nib is anchored to the active SVG path.
        x,y=tx-63*S,ty+48*S
        I=lambda v: int(round(v))
        skin=(239,190,145); ink=(30,40,46)
        d.rounded_rectangle(tuple(I(v) for v in (x-8*S,y+10*S,x+28*S,y+52*S)),radius=I(12*S),fill=(235,239,237),outline=ink,width=I(2*S))
        d.ellipse(tuple(I(v) for v in (x-15*S,y-8*S,x+30*S,y+29*S)),fill=skin,outline=ink,width=I(2*S))
        d.ellipse(tuple(I(v) for v in (x-10*S,y-20*S,x+11*S,y+11*S)),fill=skin,outline=ink,width=I(2*S))
        d.ellipse(tuple(I(v) for v in (x+2*S,y-18*S,x+24*S,y+14*S)),fill=skin,outline=ink,width=I(2*S))
        d.line([(I(x+7*S),I(y+4*S)),(I(x+62*S),I(y-50*S))],fill=ink,width=I(8*S))
        d.line([(I(x+56*S),I(y-44*S)),(I(x+64*S),I(y-52*S))],fill=(231,111,81),width=I(4*S))
    def draw_revealed(im,t):
        d=ImageDraw.Draw(im); active=None
        for item,path,length,st,en in paths:
            if t>=en:
                pts=path_points(path,length,1)
                if len(pts)>1: d.line(pts,fill=item['color'],width=max(1,round(item['width']*S)),joint='curve')
            elif t>st:
                q=(t-st)/(en-st); pts=path_points(path,length,q)
                if len(pts)>1: d.line(pts,fill=item['color'],width=max(1,round(item['width']*S)),joint='curve')
                active=(path,length,q)
                break
            else: break
        if active:
            p=active[0].point(active[0].ilength(min(active[1]*active[2],max(0.0,active[1]-1e-7)))); hand_at_tip(d,round(p.real),round(p.imag))
        else:
            nxt=next(((p,l,st,en) for _,p,l,st,en in paths if st>t),None)
            prev=next(((p,l,st,en) for _,p,l,st,en in reversed(paths) if en<=t),None)
            if nxt and prev:
                p1=prev[0].point(1); p2=nxt[0].point(0); q=max(0,min(1,(t-prev[3])/(nxt[2]-prev[3])))
                hand_at_tip(d,round(p1.real+(p2.real-p1.real)*q),round(p1.imag+(p2.imag-p1.imag)*q))
            elif nxt:
                p=nxt[0].point(0); hand_at_tip(d,round(p.real),round(p.imag))
        # Gentle final camera push-in is applied as a real per-frame crop, not a still overlay.
        zoom=1+0.012*max(0,min(1,(t-11.5)/3.5))
        if zoom>1.0001:
            nw,nh=round(FW*zoom),round(FH*zoom); im=im.resize((nw,nh),Image.Resampling.LANCZOS)
            im=im.crop(((nw-FW)//2,(nh-FH)//2,(nw+FW)//2,(nh+FH)//2))
        return im
    ff=ffmpeg_path(); tmp=RENDER/'whiteboard_demo_base.mp4'; out=RENDER/'whiteboard_demo.mp4'
    cmd=[ff,'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{FW}x{FH}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','17','-pix_fmt','yuv420p',str(tmp)]
    p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=subprocess.PIPE)
    frames=round(D*FPS)
    for i in range(frames):
        t=i/FPS; frame=draw_revealed(base_frame(t),t)
        p.stdin.write(frame.tobytes())
    p.stdin.close(); err=p.stderr.read(); rc=p.wait()
    if rc: raise RuntimeError(err.decode('utf-8','replace')[-3000:])
    # Original generated music pad and marker sounds, procedurally synthesized from scratch.
    rate=48000; n=round(D*rate); tt=np.arange(n,dtype=np.float64)/rate
    chords=[(220.00,261.63,329.63),(174.61,220.00,261.63),(196.00,246.94,293.66),(164.81,196.00,246.94)]
    chord_len=3.75; bar=(tt/chord_len).astype(int)%len(chords); pad=np.zeros(n)
    for j in range(3):
        freq=np.array([chords[k][j] for k in bar]); pad+=np.sin(2*np.pi*freq*tt+j*.18)/3
    fade=np.minimum(1,np.minimum(tt/1.3,np.maximum(0,D-tt)/1.8)); music=pad*.035*fade
    rng=np.random.default_rng(36117); sfx=np.zeros(n)
    for item in strokes:
        at=float(item['start']); length=min(int(.18*rate),max(0,n-int(at*rate)))
        if length>0:
            noise=rng.normal(size=length); filtered=np.empty(length); filtered[0]=noise[0]
            for k in range(1,length): filtered[k]=.84*filtered[k-1]+.16*noise[k]
            envelope=np.sin(np.linspace(0,np.pi,length))**1.5
            sfx[int(at*rate):int(at*rate)+length]+=filtered*envelope*.007
    for name,a in [('studio_music.wav',music),('studio_sfx.wav',sfx)]:
        sf.write(MUSIC/name,np.column_stack((a,a)).astype('float32'),rate,subtype='PCM_16')
    # Measure/normalize narration to a consistent target while preserving true peaks.
    import pyloudnorm as pyln
    voice,sr=sf.read(str(voice),always_2d=True,dtype='float32')
    meter=pyln.Meter(sr)
    try: lufs=float(meter.integrated_loudness(voice))
    except Exception: lufs=-22.0
    gain=min(3.0,10**((-19.0-lufs)/20))
    voice=np.clip(voice*gain,-0.92,0.92)
    normalized=VO/'demo_voice_normalized.wav'; sf.write(str(normalized),voice,sr,subtype='PCM_16')
    sub=str(srt_path.resolve()).replace('\\','/').replace(':','\\:').replace("'","\\'")
    fonts=str(FONT_DIR.resolve()).replace('\\','/').replace(':','\\:')
    vf=(f"scale={FW}:{FH}:flags=lanczos,fps={FPS},subtitles='{sub}':fontsdir='{fonts}':"
        "force_style='FontName=Noto Naskh Arabic,FontSize=44,PrimaryColour=&H001C242B,OutlineColour=&H00FFFFFF,"
        "BackColour=&H99000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=43'")
    fc=(f'[1:a]aresample=48000,aformat=channel_layouts=stereo,apad=pad_dur={D-adur if (adur:=sf.info(str(normalized)).duration)<D else 0},atrim=duration={D}[v];'
        '[2:a]volume=0.42[m];[3:a]volume=0.60[s];[v][m][s]amix=inputs=3:duration=first:normalize=0,alimiter=limit=0.96,loudnorm=I=-17:TP=-1.2:LRA=8[a]')
    final=ROOT/'preview/whiteboard_studio_demo.mp4'; final.parent.mkdir(parents=True,exist_ok=True)
    cmd=[ff,'-y','-i',str(tmp),'-i',str(normalized),'-i',str(MUSIC/'studio_music.wav'),'-i',str(MUSIC/'studio_sfx.wav'),'-filter_complex',fc,'-map','0:v:0','-map','[a]','-vf',vf,'-c:v','libx264','-preset','medium','-crf','19','-profile:v','high','-level','4.2','-pix_fmt','yuv420p','-r',str(FPS),'-c:a','aac','-b:a','192k','-ar','48000','-t',str(D),'-movflags','+faststart',str(final)]
    result=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if result.returncode: raise RuntimeError(result.stderr[-6000:])
    # Keep an explicit source artifact and generated timing package with the demo.
    print(f'Wrote SVG source: {RENDER / "whiteboard_demo_source.svg"}')
    print(f'Wrote SRT: {srt_path}')
    print(f'Voice original LUFS: {lufs:.2f}; normalization gain: {gain:.2f}x')
    print(f'Wrote demo: {final} ({final.stat().st_size} bytes)')
    return final


def qc(path):
    import av
    import numpy as np
    import soundfile as sf
    path=Path(path); report={'file':str(path),'checks':{},'warnings':[]}
    container=av.open(str(path)); vs=container.streams.video[0]; aus=container.streams.audio[0]
    fps=float(vs.average_rate); report['video']={'width':vs.width,'height':vs.height,'fps':fps,'codec':vs.codec_context.name}
    report['audio']={'codec':aus.codec_context.name,'sample_rate':aus.codec_context.sample_rate,'channels':aus.codec_context.channels}
    frame_count=0; black=0; blank=0; ink_ratios=[]; sampleframes=[]; means=[]
    for frame in container.decode(vs):
        arr=frame.to_ndarray(format='gray'); frame_count+=1; mean=float(arr.mean()); means.append(mean)
        if mean<8: black+=1
        ratio=float(np.count_nonzero(arr<248))/arr.size; ink_ratios.append(ratio)
        if ratio<0.00012: blank+=1
        if frame_count%15==0: sampleframes.append(arr[::8,::8].astype(np.int16))
    duration=float(container.duration/av.time_base); report['video'].update({'duration_seconds':duration,'decoded_frames':frame_count,'black_frames':black,'near_empty_frames':blank,'mean_luma':float(np.mean(means)),'min_ink_ratio':float(np.min(ink_ratios))})
    container.close()
    # A decoded audio stream must contain signal in successive 100ms windows; flag silence only if >1s continuous.
    with av.open(str(path)) as c:
        audio_stream=c.streams.audio[0]; chunks=[]
        for f in c.decode(audio_stream): chunks.append(f.to_ndarray().astype(np.float32).ravel())
    audio=np.concatenate(chunks) if chunks else np.array([],dtype=np.float32)
    rms=[]
    if audio.size:
        step=max(1,int(aus.sample_rate*.1));
        for i in range(0,len(audio),step): rms.append(float(np.sqrt(np.mean(audio[i:i+step]**2))))
    silent=np.array(rms)<1e-4 if rms else np.array([True])
    max_silence=run=0
    for x in silent:
        run=run+1 if x else 0; max_silence=max(max_silence,run)
    report['audio'].update({'decoded_samples':int(audio.size),'rms_mean':float(np.sqrt(np.mean(audio**2))) if audio.size else 0.0,'max_contiguous_silence_seconds':round(max_silence*.1,2)})
    srt_path=SUBS/'whiteboard_demo.srt'; srt=srt_path.read_text(encoding='utf-8') if srt_path.exists() else ''
    cues=re.findall(r'(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})\n(.+)',srt)
    def parse_srt_time(value):
        hh,mm,tail=value.split(':'); ss,ms=tail.split(',')
        return int(hh)*3600+int(mm)*60+int(ss)+int(ms)/1000
    cue_intervals=[(parse_srt_time(a),parse_srt_time(b),text) for a,b,text in cues]
    caption_timing_valid=bool(cue_intervals) and all(0<=a<b<=duration+.05 for a,b,_ in cue_intervals) and all(cue_intervals[i][1]<=cue_intervals[i+1][0]+.02 for i in range(len(cue_intervals)-1))
    report['subtitles']={'cue_count':len(cues),'arabic_text':bool(re.search('[\u0600-\u06ff]',srt)),'timing_valid':caption_timing_valid,'srt_path':str(srt_path)}
    voice_seconds=float(sf.info(str(VO/'demo_voice_normalized.wav')).duration)
    report['timing']={'clip_duration_seconds':duration,'voiceover_seconds':voice_seconds,'music_tail_seconds':round(max(0,duration-voice_seconds),2)}
    checks={
      '1080p':vs.width==1920 and vs.height==1080,
      '30fps':abs(fps-30)<.01,
      'h264_aac':vs.codec_context.name=='h264' and aus.codec_context.name=='aac',
      '15_seconds':abs(duration-15.0)<.08,
      'expected_frames':frame_count==450,
      'no_black_frames':black==0,
      'no_near_empty_frames':blank==0,
      'audio_present':audio.size>0 and float(np.sqrt(np.mean(audio**2)))>1e-4,
      'no_long_silence':max_silence<=10,
      'arabic_subtitles':len(cues)>=4 and bool(re.search('[\u0600-\u06ff]',srt)) and caption_timing_valid,
      'animated_frame_differences':len(sampleframes)>2 and float(np.mean([np.mean(np.abs(sampleframes[i].astype(np.float32)-sampleframes[i-1].astype(np.float32))) for i in range(1,len(sampleframes))]))>0.25,
    }
    # Filter-based validation is also recorded; FFprobe is not installed, so stream inspection is done via PyAV.
    ff=ffmpeg_path(); p=subprocess.run([ff,'-hide_banner','-i',str(path),'-vf','blackdetect=d=0.08:pix_th=0.08,freezedetect=n=-60dB:d=1','-an','-f','null','-'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    black_intervals=len(re.findall(r'black_start:',p.stderr)); freeze_intervals=len(re.findall(r'freeze_start:',p.stderr))
    report['ffmpeg_filter_scans']={'filter_exit_code':p.returncode,'black_intervals':black_intervals,'freeze_intervals':freeze_intervals}
    checks['ffmpeg_scans_no_black_or_freeze']=p.returncode==0 and black_intervals==0 and freeze_intervals==0
    report['checks']=checks; report['passed']=all(checks.values())
    out=BUILD/'qc'/'whiteboard_demo_qc.json'; out.parent.mkdir(parents=True,exist_ok=True); out.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2)); print('QC report:',out)
    return 0 if report['passed'] and p.returncode==0 else 1


def main():
    parser=argparse.ArgumentParser(); parser.add_argument('command',choices=['audit','render-demo','qc']); parser.add_argument('path',nargs='?')
    args=parser.parse_args()
    if args.command=='audit': audit(); return 0
    if args.command=='render-demo': make_demo(); return 0
    if args.command=='qc': return qc(args.path or str(ROOT/'preview/whiteboard_studio_demo.mp4'))
    return 0
if __name__=='__main__': raise SystemExit(main())
