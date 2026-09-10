"""Independent compressed, multipart and mixed-channel OpenEXR verification."""
import json,sys
from pathlib import Path
import numpy as np
import OpenEXR
out=Path(sys.argv[1] if len(sys.argv)>1 else 'test-results/gpu/interop')
report={'implementation':'OpenEXR official Python module','version':getattr(OpenEXR,'__version__','unknown'),'checks':[]}
for fixture in json.loads((out/'aureon-generated.json').read_text()):
    with OpenEXR.File(str(out/fixture['file']),separate_channels=True) as image:
        assert len(image.parts)==len(fixture['parts'])
        for i,part in enumerate(fixture['parts']):
            for name,expected in part['channels'].items():
                actual=image.parts[i].channels[name].pixels
                assert actual.shape==(part['height'],part['width'])
                np.testing.assert_allclose(actual.reshape(-1),expected,rtol=0,atol=.002)
                if name=='objectId':assert actual.dtype==np.uint32
    report['checks'].append({'name':'Official OpenEXR decodes '+fixture['file'],'passed':True})
# Reciprocal test: independent encoder -> Aureon decoder. Multiple scanline
# blocks (height 19), compressible values, fractional HDR, UINT and HALF mixed.
manifest=[]
for compression_name in ['ZIP','ZIPS']:
    channels={'R':(np.arange(37*19).reshape(19,37)%37/8-1).astype('float16'),'G':np.full((19,37),4.5,dtype='float32'),'objectId':np.arange(37*19,dtype='uint32').reshape(19,37)+4000000000}
    for multi in [False,True]:
        header={'compression':getattr(OpenEXR,compression_name+'_COMPRESSION'),'type':OpenEXR.scanlineimage}
        parts=[OpenEXR.Part(header,{'R':channels['R'],'G':channels['G']},'beauty'),OpenEXR.Part(header,{'objectId':channels['objectId']},'guides')] if multi else [OpenEXR.Part(header,channels,'part0')]
        name=f'openexr-{compression_name}-{multi}.exr'
        with OpenEXR.File(parts) as image:image.write(str(out/name))
        manifest.append({'file':name,'parts':[{'width':37,'height':19,'channels':{k:v.pixels.reshape(-1).tolist() for k,v in p.channels.items()}} for p in parts]})
(out/'openexr-generated.json').write_text(json.dumps(manifest))
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
