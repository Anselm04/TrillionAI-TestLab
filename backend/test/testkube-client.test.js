import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createTestkubeClient} from '../src/testkube-client.js';
test('local client submits registered test and verifies execution identity, never claims independent pass',async t=>{
 let executionName,requests=0;
 const server=http.createServer(async(req,res)=>{
  requests++;res.setHeader('content-type','application/json');
  if(req.method==='POST'){assert.equal(req.url,'/v1/tests/smoke/executions');let s='';for await(const c of req)s+=c;const b=JSON.parse(s);assert.deepEqual(Object.keys(b),['name']);executionName=b.name;}
  else assert.equal(req.url,'/v1/executions/abc123');
  res.end(JSON.stringify({id:'abc123',testName:'smoke',name:executionName,executionResult:{status:req.method==='POST'?'queued':'passed'}}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.close(r);server.closeAllConnections();}));
 const client=createTestkubeClient({origin:'http://127.0.0.1:'+server.address().port,approvedTests:['smoke']});
 await assert.rejects(client.submit('../other'));
 const submitted=await client.submit('smoke');assert.equal(submitted.status,'QUEUED');
 const inspected=await client.inspect(submitted);assert.equal(inspected.status,'ENGINE_REPORTED_PASS');assert.equal(inspected.independentlyVerified,false);assert.equal(inspected.productionReady,false);
 await assert.rejects(client.inspect({...submitted,executionName:'testlab-00000000-0000-0000-0000-000000000000'}));
 assert.equal(requests,3);
});
test('rejects remote targets, credentials and unapproved configuration',()=>{
 for(const origin of ['https://127.0.0.1:8080','http://example.com:8080','http://a:b@127.0.0.1:8080','http://127.0.0.1:8080/v1'])assert.throws(()=>createTestkubeClient({origin,approvedTests:['smoke']}));
 assert.throws(()=>createTestkubeClient({origin:'http://127.0.0.1:8080',approvedTests:[]}));
});
