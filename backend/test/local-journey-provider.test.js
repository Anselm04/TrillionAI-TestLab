import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLocalJourneyProvider} from '../src/local-journey-provider.js';
import {planCustomerJourneys} from '../src/customer-journey-planner.js';
const catalog={syntheticOnly:true,networkIsolationConfirmed:true,packageName:'com.test.app',buildSha256:'a'.repeat(64),selectors:[{text:'Welcome',permission:'observe'}]};
const journey={id:'welcome',packageName:catalog.packageName,steps:[{action:'launch'},{action:'assertVisible',text:'Welcome'},{action:'stop'}]};
test('local proposal passes through existing trusted policy validation',async()=>{
 const propose=createLocalJourneyProvider({model:'local-model',request:async(url,options)=>{
  assert.equal(url.href,'http://127.0.0.1:11434/api/chat');assert.equal(options.redirect,'error');
  assert.equal(JSON.parse(options.body).stream,false);
  return new Response(JSON.stringify({done:true,message:{content:JSON.stringify({journeys:[journey]})}}));
 }});
 assert.equal((await planCustomerJourneys({catalog,propose}))[0].status,'PLANNED');
});
test('reject external endpoints and incomplete or oversized responses',async()=>{
 assert.throws(()=>createLocalJourneyProvider({model:'local-model',endpoint:'https://example.com'}));
 assert.throws(()=>createLocalJourneyProvider({model:'example:cloud'}));
 for(const body of ['x'.repeat(262145),JSON.stringify({done:false}),JSON.stringify({done:true,message:{content:'{}'}})]){
  const propose=createLocalJourneyProvider({model:'local-model',request:async()=>new Response(body)});
  await assert.rejects(propose({}));
 }
});
