import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

test('authenticated overlapping submissions are admitted with bounded backpressure', async t => {
  let calls=0, active=0, peak=0;
  let release, entered;
  const gate=new Promise(r=>{release=r;});
  const firstEntered=new Promise(r=>{entered=r;});
  const engine=http.createServer(async(req,res)=>{
    const number=++calls;
    peak=Math.max(peak,++active);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const {name}=JSON.parse(Buffer.concat(chunks));
    if(number===1){entered();await gate;}
    active--;
    res.setHeader('content-type','application/json');
    res.end(JSON.stringify({id:'id-'+number,number,name:name+'-'+number,testName:'smoke',executionResult:{status:'queued'}}));
  });
  await new Promise(r=>engine.listen(0,'127.0.0.1',r));
  t.after(()=>{release();engine.closeAllConnections();return new Promise(r=>engine.close(r));});
  const reserve=http.createServer();
  await new Promise(r=>reserve.listen(0,'127.0.0.1',r));
  const port=reserve.address().port;
  await new Promise(r=>reserve.close(r));
  const token='local-test-token-not-a-production-secret';
  const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('..',import.meta.url),env:{...process.env,PORT:String(port),TESTLAB_HOST:'127.0.0.1',TESTLAB_TOKEN:token,TESTLAB_TESTKUBE_ORIGIN:'http://127.0.0.1:'+engine.address().port,TESTLAB_TESTKUBE_TESTS:'smoke'},stdio:'ignore'});
  t.after(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit');}});
  const url='http://127.0.0.1:'+port;
  for(let i=0;i<100;i++){
    if(await fetch(url+'/health').then(r=>r.ok).catch(()=>false))break;
    await delay(20);
  }
  const submit=(auth=token)=>fetch(url+'/testkube/executions',{method:'POST',headers:{authorization:'Bearer '+auth,'content-type':'application/json'},body:JSON.stringify({testName:'smoke'}),signal:AbortSignal.timeout(5000)});
  const first=submit();await firstEntered;
  const second=submit();
  await delay(100);
  assert.equal((await submit('invalid')).status,401);
  assert.equal((await submit()).status,429);
  release();
  const responses=await Promise.all([first,second]);
  assert.deepEqual(responses.map(r=>r.status),[202,202]);
  const results=await Promise.all(responses.map(r=>r.json()));
  assert.notEqual(results[0].executionId,results[1].executionId);
  assert.equal(peak,1);
  assert.equal(calls,2);
  assert.equal((await submit()).status,202);
});
