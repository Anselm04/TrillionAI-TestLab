import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateJourney,compileMaestro,executeJourney} from '../src/mobile-journey.js';
const journey={id:'login',packageName:'com.test.app',steps:[{action:'launch'},{action:'tapText',text:'Sign in (test)'},{action:'assertVisible',text:'Welcome'},{action:'stop'}]};
test('compile fixed action schema and escape selector regex',()=>{
 const flow=compileMaestro(journey);
 const [header,commands]=flow.split('\n---\n').map(JSON.parse);
 assert.equal(header.appId,'com.test.app');
 assert.deepEqual(commands,['launchApp',{tapText:{text:'^Sign in \\(test\\)$'}},{assertVisible:{text:'^Welcome$'}},'stopApp']);
});
test('reject arbitrary commands, interpolation and journeys without assertions',()=>{
 for(const step of [{action:'runScript',text:'x'},{action:'tapText',text:'${SECRET}'},{action:'assertVisible',text:'\n'}]){
  assert.throws(()=>validateJourney({...journey,steps:[journey.steps[0],step,journey.steps[3]]}));
 }
 assert.throws(()=>validateJourney({...journey,steps:[journey.steps[0],journey.steps[1],journey.steps[3]]}));
});
test('execution reports only command outcome and binds build and flow digests',async()=>{
 const input={journey,deviceId:'device-1',buildSha256:'a'.repeat(64)};
 const good=await executeJourney({...input,execute:async()=>({exitCode:0,output:'fixture'})});
 assert.equal(good.status,'COMMAND_SUCCEEDED');assert.equal(good.independentReview,'PENDING');assert.equal(good.deploymentAuthorized,false);
 assert.match(good.flowSha256,/^[a-f0-9]{64}$/);
 for(const [result,status] of [[{exitCode:1,output:'failed'},'COMMAND_FAILED'],[{exitCode:0,output:''},'INFRASTRUCTURE_ERROR'],[{exitCode:0,output:'x',outputTruncated:true},'INFRASTRUCTURE_ERROR'],[{timedOut:true},'TIMEOUT']]){
  assert.equal((await executeJourney({...input,execute:async()=>result})).status,status);
 }
 assert.equal((await executeJourney({...input,execute:async()=>{throw Error('offline');}})).status,'INFRASTRUCTURE_ERROR');
});
