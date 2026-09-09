"""Independent codec consumers. OpenCV checks RGB FLOAT, not arbitrary EXR AOVs.
Requires an OpenEXR-enabled OpenCV build and Pillow; these are test-only tools.
"""
import os
os.environ['OPENCV_IO_ENABLE_OPENEXR']='1'
import json
from pathlib import Path
import cv2
from PIL import Image
root=Path(__file__).resolve().parents[1]/'test-results/v0.2'
image=cv2.imread(str(root/'independent.exr'),cv2.IMREAD_UNCHANGED)
assert image is not None and image.shape==(2,2,3)
rgb=image[:,:,::-1]
expected=[(.1,.2,.3),(3.5,.5,.8),(-.4,.6,.9),(1,1,1)]
for p,e in zip(rgb.reshape(-1,3),expected):assert all(abs(float(v)-q)<1e-6 for v,q in zip(p,e))
image=Image.open(root/'independent.png');assert image.mode=='RGBA' and image.size==(2,1)
assert list(image.getdata())==[(255,0,0,255),(0,128,255,127)]
report={'status':'passed','checks':['OpenCV independently decodes unclamped RGB FLOAT EXR','Pillow independently decodes exact RGBA PNG'],'scope':'EXR UINT/AOV channels tested by the project reader, not OpenCV. This test does not exercise GPU rendering.','opencv':cv2.__version__}
(root/'independent-codecs.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
