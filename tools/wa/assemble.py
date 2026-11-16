"""Create the final Arabic audio mix, subtitles, music, and 1080p H.264 export."""
from __future__ import annotations
import math, re, wave, subprocess
from pathlib import Path
import numpy as np

ROOT=Path(__file__).resolve().parents[2]
BUILD=ROOT/'build'; OUT=ROOT/'output'/'الأثر-التراكمي-العادات-الصغيرة'
OUT.mkdir(parents=True,exist_ok=True)


def parse_script():
    raw=(BUILD/'script/05_Script.txt').read_text(encoding='utf-8')
    parts=re.split(r'\[المشهد\s+(\d+)\s+—[^\]]*\]\s*',raw)
    # split gives title/prefix, number, content ...
    return [(int(parts[i]),parts[i+1].strip()) for i in range(1,len(parts),2)]

def audio_durations():
    ds=[]
    for i in range(1,9):
        with wave.open(str(BUILD/f'vo/scene{i:02}.wav'),'rb') as w: ds.append(w.getnframes()/w.getframerate())
    return ds

def srt_time(t):
    ms=max(0,round(t*1000)); h,ms=divmod(ms,3600000); m,ms=divmod(ms,60000); s,ms=divmod(ms,1000)
    return f'{h:02}:{m:02}:{s:02},{ms:03}'

def caption_chunks(text):
    sentences=re.split(r'(?<=[.!؟])\s+',text.strip())
    out=[]
    for sentence in sentences:
        sentence=sentence.strip()
        if not sentence: continue
        # Break unusually long spoken lines at natural comma/colon boundaries.
        if len(sentence)>88:
            pieces=re.split(r'(?<=[،؛:])\s*',sentence)
            cur=''
            for p in pieces:
                if cur and len(cur)+len(p)>76: out.append(cur.strip()); cur=p
                else: cur=(cur+' '+p).strip()
            if cur: out.append(cur)
        else: out.append(sentence)
    return out

def wrap_ar(s, width=45):
    words=s.split(); lines=[]; cur=''
    for word in words:
        if cur and len(cur)+len(word)+1>width: lines.append(cur); cur=word
        else: cur=(cur+' '+word).strip()
    if cur: lines.append(cur)
    return '\n'.join(lines[:2])

def build_voice_and_srt():
    chapters=parse_script(); durations=audio_durations()
    # All source clips are same-format PCM. Concatenate with no artificial gaps.
    first=BUILD/'vo/scene01.wav'
    with wave.open(str(first),'rb') as ref:
        params=ref.getparams()
        with wave.open(str(BUILD/'vo/final.wav'),'wb') as outw:
            outw.setparams(params)
            for i in range(1,9):
                with wave.open(str(BUILD/f'vo/scene{i:02}.wav'),'rb') as src:
                    if (src.getframerate(),src.getnchannels(),src.getsampwidth()) != (params.framerate,params.nchannels,params.sampwidth):
                        raise ValueError('Source speech clips have inconsistent audio format')
                    outw.writeframes(src.readframes(src.getnframes()))
    entries=[]; offset=0.0
    for (num,txt),duration in zip(chapters,durations):
        chunks=caption_chunks(txt)
        weights=[max(1,len(re.sub(r'\s','',c)))+4*sum(c.count(p) for p in '،؛.!؟') for c in chunks]
        total=sum(weights); cursor=offset
        for k,(chunk,w) in enumerate(zip(chunks,weights)):
            span=duration*w/total
            # Tiny overlap-free breathing gaps between caption cards.
            st=cursor; en=offset+duration if k==len(chunks)-1 else cursor+span-.04
            entries.append((st,max(st+.8,en),wrap_ar(chunk)))
            cursor+=span
        offset+=duration
    srt=[]
    for i,(a,b,text) in enumerate(entries,1):
        srt += [str(i),f'{srt_time(a)} --> {srt_time(b)}',text,'']
    srt_path=OUT/'04_Subtitles.srt'; srt_path.write_text('\n'.join(srt),encoding='utf-8')
    # The SRT remains standards-friendly; an ASS companion gives burned captions
    # a fixed lower safe-zone so they never cover the whiteboard drawings.
    def ass_ts(t):
        cs=round(t*100); h,cs=divmod(cs,360000); m,cs=divmod(cs,6000); s,cs=divmod(cs,100)
        return f'{h}:{m:02}:{s:02}.{cs:02}'
    ass=['[Script Info]','ScriptType: v4.00+','PlayResX: 1920','PlayResY: 1080','WrapStyle: 2','ScaledBorderAndShadow: yes',
         '[V4+ Styles]','Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
         'Style: Default,Noto Naskh Arabic,64,&H001C242B,&H000000FF,&H00FFFFFF,&HFF000000,0,0,0,0,100,100,0,0,1,2,1,2,70,70,50,1',
         '[Events]','Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for a,b,text in entries:
        txt=text.replace(chr(10),chr(92)+'N')
        ass.append('Dialogue: 0,'+ass_ts(a)+','+ass_ts(b)+',Default,,0,0,0,,{'+chr(92)+'an2'+chr(92)+'pos(960,1025)}'+txt)
    (BUILD/'subs/captions.ass').write_text('\n'.join(ass)+'\n',encoding='utf-8')
    return durations,offset,srt_path

def music_and_sfx(total,chapter_durations):
    rate=48000; outmusic=BUILD/'music/original_ambient.wav'; outsfx=BUILD/'music/marker_sfx.wav'
    beat=60/76; chord_len=beat*4
    chords=[(220.00,261.63,329.63),(174.61,220.00,261.63),(130.81,164.81,196.00),(196.00,246.94,293.66)]
    # Synthesised pads and gentle plucks are original audio, not sampled material.
    with wave.open(str(outmusic),'wb') as wf:
        wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(rate)
        chunk=rate*2; n_total=math.ceil((total+.6)*rate); idx=0
        while idx<n_total:
            n=min(chunk,n_total-idx); t=(np.arange(idx,idx+n,dtype=np.float64)/rate)
            beatpos=t/beat; bar=np.floor(t/chord_len).astype(int); chordidx=(bar%len(chords))
            pad=np.zeros(n,dtype=np.float64)
            for j in range(3):
                freqs=np.array([chords[int(k)][j] for k in chordidx])
                pad += np.sin(2*np.pi*freqs*t + j*.19)/3
                pad += .14*np.sin(4*np.pi*freqs*t + j*.27)
            phase=np.mod(beatpos,1.0)
            noteidx=np.floor(beatpos).astype(int)%3
            freq=np.empty(n)
            for k, chord in enumerate(chords):
                mask=chordidx==k
                freq[mask]=np.asarray(chord)[noteidx[mask]]*2
            pluck=np.sin(2*np.pi*freq*t)*np.exp(-phase*5.5)*.22
            # Gentle stereo movement, fades, and low output level beneath speech.
            pan=.5+.25*np.sin(2*np.pi*t/17)
            mix=(pad*.075+pluck*.035)
            fade=np.minimum(1,np.minimum(t/1.7,np.maximum(0,total-t)/2.5))
            left=np.clip(mix*fade*(1-pan),-.8,.8); right=np.clip(mix*fade*pan,-.8,.8)
            stereo=np.column_stack((left,right))
            wf.writeframes((stereo*32767).astype('<i2').tobytes()); idx+=n
    # Soft, brief synthetic marker swishes at board transitions; no recordings used.
    total_frames=math.ceil((total+.2)*rate); sfx=np.zeros(total_frames,dtype=np.float32)
    rng=np.random.default_rng(70216)
    starts=[]; off=0
    for sec in chapter_durations:
        starts.extend([off,off+sec/3,off+2*sec/3]); off+=sec
    length=int(.32*rate); noise=rng.normal(0,1,length)
    # Simple one-pole lowpass makes a soft paper/marker texture.
    smooth=np.empty_like(noise); smooth[0]=noise[0]
    for j in range(1,length): smooth[j]=.84*smooth[j-1]+.16*noise[j]
    env=np.sin(np.linspace(0,np.pi,length))**1.6
    swish=(smooth*env*.035).astype(np.float32)
    for start in starts:
        p=int(start*rate); q=min(total_frames,p+length); sfx[p:q]+=swish[:q-p]
    stereo=np.column_stack((sfx,sfx))
    with wave.open(str(outsfx),'wb') as wf:
        wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(rate); wf.writeframes((np.clip(stereo,-.8,.8)*32767).astype('<i2').tobytes())
    return outmusic,outsfx

def mux(srt,music,sfx):
    ff=__import__('imageio_ffmpeg').get_ffmpeg_exe()
    vid=BUILD/'render/boards.mp4'; vo=BUILD/'vo/final.wav'; final=OUT/'01_Final_Video.mp4'
    # Escape filter-path punctuation for ffmpeg's subtitles filter.
    assfile=BUILD/'subs/captions.ass'
    subpath=str(assfile.resolve()).replace('\\','/').replace(':','\\:').replace("'", "\\'")
    fonts=str((ROOT/'assets/fonts').resolve()).replace('\\','/').replace(':','\\:')
    vf=f"scale=1920:1080:flags=lanczos,fps=30,subtitles='{subpath}':fontsdir='{fonts}'"
    cmd=[ff,'-y','-i',str(vid),'-i',str(vo),'-i',str(music),'-i',str(sfx),
         '-filter_complex','[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0,alimiter=limit=0.95[voice];[2:a]volume=1.3[music];[3:a]volume=0.7[sfx];[voice][music][sfx]amix=inputs=3:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95,afade=t=out:st='+str(max(0,total_audio-3)) + ':d=3[a]',
         '-map','0:v:0','-map','[a]','-vf',vf,'-c:v','libx264','-preset','medium','-crf','21','-profile:v','high','-level','4.2','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-shortest',str(final)]
    p=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    if p.returncode: raise RuntimeError(p.stderr[-7000:])
    print(p.stderr[-1800:])
    return final

if __name__=='__main__':
    durations,total,srt=build_voice_and_srt()
    music,sfx=music_and_sfx(total,durations)
    total_audio=total
    print('Narration duration:',round(total,2),'sec')
    print('Rendering final H.264 MP4...')
    mux(srt,music,sfx)
