const {test}=require('node:test');const assert=require('node:assert/strict');
const {allowMediaRequest}=require('../electron/media-policy.cjs');
test('armed system capture allows display-capture including video, but never camera',()=>{
  const input={trusted:true,mode:'system',permission:'display-capture',mediaTypes:['video','audio']};
  assert.equal(allowMediaRequest(input),true);
  assert.equal(allowMediaRequest({...input,permission:'media',mediaTypes:['video']}),false);
  assert.equal(allowMediaRequest({...input,mode:'microphone'}),false);
  assert.equal(allowMediaRequest({...input,mode:null}),false);
  assert.equal(allowMediaRequest({...input,trusted:false}),false);
  assert.equal(allowMediaRequest({...input,mainFrame:false}),false);
});
test('microphone is allowed only from an armed trusted document',()=>{
  assert.equal(allowMediaRequest({trusted:true,mode:'microphone',permission:'media',mediaTypes:['audio']}),true);
  assert.equal(allowMediaRequest({trusted:true,mode:'microphone',permission:'media',mediaTypes:[]}),false);
  assert.equal(allowMediaRequest({trusted:true,mode:'microphone',permission:'notifications'}),false);
});
test('capture diagnostics distinguish app rejection, cancellation, focus and OS settings',async()=>{
  const {captureError}=await import('../src/capture.mjs');
  const denied={name:'NotAllowedError'};
  assert.match(captureError(denied,'system',{screen:'granted'}),/уже выдан/);
  assert.equal(captureError(denied,'system',{applicationDenial:'App rejected screen'}),'App rejected screen');
  assert.match(captureError({name:'InvalidStateError'},'system'),/активным/);
  assert.match(captureError(denied,'microphone'),/Микрофон/);
});
