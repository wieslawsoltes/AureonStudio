import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMaterialWGSL,specializeMaterialSource} from '../src/materials/wgsl-graph.js';
const defaultGraph=(value=[.2,.4,.8])=>({nodes:[{id:'color',type:'constant',value},{id:'rough',type:'constant',value:.3}],outputs:{baseColor:'color',roughness:'rough'}});
import {readFile} from 'node:fs/promises';
test('Material graphs compile to SSA WGSL without a register array or interpreter loop',()=>{const m={graph:defaultGraph([.2,.4,.8])},a=compileMaterialWGSL([m]);assert.ok(a.source.includes('let r0='));assert.ok(a.source.includes('m.base.w='));assert.ok(!a.source.includes('array<vec4f,64>'));assert.ok(!a.source.includes('for('));assert.equal(a.instructions,3);});
test('Changing graph values reuses the pipeline while changing connectivity invalidates it',()=>{const m={graph:defaultGraph()},a=compileMaterialWGSL([m]);m.graph.nodes[0].value=[1,0,0];assert.equal(a.key,compileMaterialWGSL([m]).key);m.graph.nodes.push({id:'uv',type:'uv'});m.graph.nodes[0]={id:'color',type:'image',inputs:{uv:'uv'},texture:0};assert.notEqual(a.key,compileMaterialWGSL([m]).key);});
test('WGSL specialization replaces the material insertion point and retains fiber functions',async()=>{const source=await readFile(new URL('../src/render/common.wgsl',import.meta.url),'utf8'),out=specializeMaterialSource(source,[{graph:defaultGraph()}]);assert.equal(out.code.match(/fn surfaceMaterial\(/g).length,1);assert.ok(out.code.includes('fn materialGraph0'));assert.ok(out.code.includes('fn setupFiber'));});
test('All native editor modules link without missing exports',async()=>{await import('../src/ui/advanced.js');});
