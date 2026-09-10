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
# Reciprocal tests use separate input dictionaries because OpenEXR.File cleanup
# releases its owned channel dictionaries. Expected pixels are serialized before
# handing ownership to the reference encoder, never recovered from its decoder.
manifest=[]
for compression_name in ['ZIP','ZIPS']:
    for multi in [False,True]:
        channels={'R':(np.arange(37*19).reshape(19,37)%37/8-1).astype('float16'),'G':np.full((19,37),4.5,dtype='float32'),'objectId':np.arange(37*19,dtype='uint32').reshape(19,37)+4000000000}
        groups=[('beauty',{'R':channels['R'],'G':channels['G']}),('guides',{'objectId':channels['objectId']})] if multi else [('part0',channels)]
        expected=[{'width':37,'height':19,'channels':{k:v.reshape(-1).tolist() for k,v in data.items()}} for _,data in groups]
        header={'compression':getattr(OpenEXR,compression_name+'_COMPRESSION'),'type':OpenEXR.scanlineimage}
        parts=[OpenEXR.Part(dict(header),{k:v.copy() for k,v in data.items()},name) for name,data in groups]
        name=f'openexr-{compression_name}-{multi}.exr'
        with OpenEXR.File(parts) as image:image.write(str(out/name))
        manifest.append({'file':name,'parts':expected})
(out/'openexr-generated.json').write_text(json.dumps(manifest))
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
