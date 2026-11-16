"""Fast tests for the SVG-path whiteboard studio and its rendered demo."""
import json, unittest
from pathlib import Path
from svgpathtools import parse_path
import av

ROOT=Path(__file__).resolve().parents[2]
MANIFEST=ROOT/'tools/wa/projects/whiteboard_studio_demo.json'
DEMO=ROOT/'preview/whiteboard_studio_demo.mp4'

class StudioTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec=json.loads(MANIFEST.read_text(encoding='utf-8'))

    def test_storyboard_uses_authored_paths_not_raster_sources(self):
        self.assertGreaterEqual(len(self.spec['strokes']),20)
        self.assertEqual(self.spec['character_id'],'habit-guide-v1')
        self.assertNotIn('image',self.spec,'illustrations must come from paths, not a raster source')
        for s in self.spec['strokes']:
            p=parse_path(s['d'])
            self.assertGreater(p.length(),0,s['id'])
            self.assertLess(s['start'],s['end'],s['id'])
        self.assertTrue(any(s['kind']=='character' for s in self.spec['strokes']))
        self.assertTrue(any(s['kind']=='chart' for s in self.spec['strokes']))

    def test_draw_order_matches_scene_story(self):
        strokes=self.spec['strokes']
        last_character=max(s['end'] for s in strokes if s['kind']=='character')
        arrow=min(s['start'] for s in strokes if s['id']=='direction-arrow')
        graph=min(s['start'] for s in strokes if s['kind']=='chart')
        self.assertLess(last_character,arrow)
        self.assertLess(arrow,graph)

    def test_arabic_subtitles_are_present_and_timed(self):
        captions=self.spec['captions']
        self.assertGreaterEqual(len(captions),4)
        self.assertTrue(all(any('\u0600'<=c<='\u06ff' for c in x['text']) for x in captions))
        self.assertTrue(all(captions[i]['end']<=captions[i+1]['start'] for i in range(len(captions)-1)))

    def test_demo_export_is_full_hd_h264_aac_30fps_15s(self):
        self.assertTrue(DEMO.exists(),'render-demo must run before export test')
        with av.open(str(DEMO)) as c:
            v=c.streams.video[0]; a=c.streams.audio[0]
            self.assertEqual((v.width,v.height),(1920,1080))
            self.assertEqual(v.codec_context.name,'h264')
            self.assertEqual(a.codec_context.name,'aac')
            self.assertAlmostEqual(float(v.average_rate),30.0,places=2)
            self.assertAlmostEqual(float(c.duration/av.time_base),15.0,places=2)
            frames=sum(1 for _ in c.decode(v))
            self.assertEqual(frames,450)

if __name__=='__main__': unittest.main(verbosity=2)
