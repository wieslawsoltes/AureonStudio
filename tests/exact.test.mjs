import test from 'node:test';import assert from 'node:assert/strict';
import {Rational,orient2d,orient3d} from '../src/geometry/exact.js';
import {exactBoolean} from '../src/geometry/exact-boolean.js';
import {createPrimitive} from '../src/geometry/primitives.js';
import {signedVolume,topology} from '../src/geometry/boolean.js';
test('Exact binary64 conversion handles subnormal, signed and very large coordinates',()=>{for(const x of [0,-0,Number.MIN_VALUE,1e-200,-.1,1,Math.PI,1e250,Number.MAX_VALUE])assert.ok(Math.abs(Rational.from(x).number()-x)<=Math.abs(x)*3e-16||Object.is(Rational.from(x).number(),x));assert.throws(()=>Rational.from(NaN));});
test('Exact orientation signs distinguish near-coplanar and collinear data',()=>{assert.equal(orient2d([0,0],[1,1],[2,2]),0);assert.equal(orient2d([0,0],[1,1],[2,2+Number.EPSILON*2]),1);assert.equal(orient3d([0,0,0],[1,0,0],[0,1,0],[.2,.2,Number.MIN_VALUE]),-1);});
for(const operation of ['union','subtract','intersect'])test(`Exact CSG ${operation} preserves rational cuts and manifold volume`,()=>{const a=createPrimitive('box',{width:2,height:2,depth:2}),b=structuredClone(a);for(let i=0;i<b.positions.length;i+=3)b.positions[i]+=.75;const out=exactBoolean(a,b,operation);assert.ok(Math.abs(signedVolume(out)-({union:11,subtract:3,intersect:5}[operation]))<1e-10);const t=topology(out);assert.equal(t.boundary+t.nonManifold+t.inconsistent,0);assert.equal(out.precision.classification,'exact-rational');});
test('Exact CSG retains a gap far below a tolerance-based split epsilon',()=>{const a=createPrimitive('box',{width:1,height:1,depth:1}),b=structuredClone(a);for(let i=0;i<b.positions.length;i+=3)b.positions[i]+=1+1e-12;const out=exactBoolean(a,b,'intersect');assert.equal(out.faces.length,0);});
