import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planCustomerJourneys} from '../src/customer-journey-planner.js';
const catalog={syntheticOnly:true,networkIsolationConfirmed:true,packageName:'com.test.app',buildSha256:'a'.repeat(64),selectors:[{text:'Next',permission:'synthetic-navigation'},{text:'Welcome',permission:'observe'},{text:'Pay',permission:'observe'}]};
const journey={id:'welcome',packageName:catalog.packageName,steps:[{action:'launch'},{action:'tapText',text:'Next'},{action:'assertVisible',text:'Welcome'},{action:'stop'}]};
test('generate validated plans without claiming execution',async()=>{
 const plans=await planCustomerJourneys({catalog,propose:async()=>[journey]});
 assert.equal(plans[0].status,'PLANNED');assert.equal(plans[0].deploymentAuthorized,false);
 assert.match(plans[0].flowSha256,/^[a-f0-9]{64}$/);
});
test('reject unapproved interactions, duplicate plans and missing isolation',async()=>{
 for(const candidate of [{...journey,steps:[journey.steps[0],{action:'tapText',text:'Pay'},...journey.steps.slice(2)]},{...journey,steps:[journey.steps[0],{action:'tapText',text:'Unknown'},...journey.steps.slice(2)]}]){
  await assert.rejects(planCustomerJourneys({catalog,propose:async()=>[candidate]}));
 }
 await assert.rejects(planCustomerJourneys({catalog,propose:async()=>[journey,journey]}));
 await assert.rejects(planCustomerJourneys({catalog:{...catalog,networkIsolationConfirmed:false},propose:async()=>[journey]}));
});
