import test from 'node:test';
import assert from 'node:assert/strict';
import {RendererError,rendererError,readShader,compileShaderModule,validateResources} from '../src/render/diagnostics.js';

// These are unit tests for error handling, not shader or GPU execution tests.
function device(messages=[],validation=null) {
 const calls=[];
 return {calls,pushErrorScope(kind){calls.push(['push',kind]);},popErrorScope(){calls.push(['pop']);return Promise.resolve(validation);},createShaderModule(descriptor){calls.push(['module',descriptor]);return {getCompilationInfo:async()=>({messages})};}};
}
test('Shader failures are never labeled as absent GPU hardware',()=>{
 const cause=Error('invalid shader');const error=rendererError(cause,'shader');
 assert.equal(error.label,'Shader error');assert.equal(error.stage,'shader');assert.equal(error.cause,cause);
 assert.match(error.title,/compilation/);assert.doesNotMatch(error.title,/adapter|unavailable/i);
 assert.equal(rendererError(error,'device'),error);
});
test('Capability, device, pipeline, resources and shader failures have separate titles',()=>{
 const stages=['security','availability','adapter','device','context','asset','shader','pipeline','resources'];
 assert.equal(new Set(stages.map(s=>new RendererError(s,'detail').title)).size,stages.length);
});
test('Shader diagnostics map combined shader lines back to the actual source file',async()=>{
 const d=device([{type:'error',lineNum:5,linePos:9,message:'bad operator'}]);
 await assert.rejects(compileShaderModule(d,'pathtrace.wgsl','code','one\ntwo\n'),e=>{
  assert.equal(e.message,'pathtrace.wgsl:3:9 bad operator');
  assert.deepEqual(e.diagnostics,[{file:'pathtrace.wgsl',line:3,column:9,message:'bad operator'}]);return true;
 });
 assert.deepEqual(d.calls.map(c=>c[0]),['push','module','pop']);
});
test('Errors in the shared prelude name common.wgsl, not the consuming shader',async()=>{
 await assert.rejects(compileShaderModule(device([{type:'error',lineNum:1,linePos:2,message:'bad prelude'}]),'raster.wgsl','code','prelude\n'),/common.wgsl:1:2/);
});
test('Warnings do not cause successful shader compilation to fail',async()=>{
 const d=device([{type:'warning',lineNum:1,linePos:1,message:'warning'}]);
 assert.equal(typeof (await compileShaderModule(d,'denoise.wgsl','code')).getCompilationInfo,'function');
});
test('Validation scope errors without compiler diagnostics still fail',async()=>{
 await assert.rejects(compileShaderModule(device([],Error('invalid module')),'test.wgsl','code'),/invalid module/);
});
test('Parallel module creation balances each scope before asynchronous awaits',async()=>{
 const d=device();await Promise.all([compileShaderModule(d,'a','code'),compileShaderModule(d,'b','code')]);
 assert.deepEqual(d.calls.map(c=>c[0]),['push','module','pop','push','module','pop']);
});
test('Synchronous module errors still pop the validation scope',async()=>{
 const d=device();d.createShaderModule=()=>{throw Error('device failed');};
 await assert.rejects(compileShaderModule(d,'test.wgsl','code'),/device failed/);
 assert.deepEqual(d.calls.map(c=>c[0]),['push','pop']);
});
test('Shader HTTP errors are asset failures, not WGSL syntax failures',async t=>{
 t.mock.method(globalThis,'fetch',async()=>({ok:false,status:404}));
 await assert.rejects(readShader('https://example.invalid/missing.wgsl'),e=>e.stage==='asset'&&e.message.includes('HTTP 404'));
});
test('Resource validation and memory scopes are balanced on success and failure',async()=>{
 const d=device();assert.equal(await validateResources(d,()=>42),42);
 assert.deepEqual(d.calls.map(c=>c[0]),['push','push','pop','pop']);
 await assert.rejects(validateResources(device([],Error('bad binding')),()=>42),e=>e.stage==='resources');
 const bad=device();await assert.rejects(validateResources(bad,()=>{throw Error('allocation');}),/allocation/);
 assert.deepEqual(bad.calls.map(c=>c[0]),['push','push','pop','pop']);
});
