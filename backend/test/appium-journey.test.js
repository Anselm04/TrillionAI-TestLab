import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createAppiumExecutor} from '../src/appium-journey.js';
const journey={id:'welcome',packageName:'com.test.app',steps:[{action:'launch'},{action:'assertVisible',text:'Welcome'},{action:'tapText',text:'Welcome'},{action:'stop'}]};
const input={journey,deviceId:'device-1',packageName:journey.packageName};
function fixture({empty=false,cleanupFailure=false}={}){
 const calls=[];
 const request=async(url,options)=>{
  const path=new URL(url).pathname;calls.push({path,...options});
  let value=null;
  if(path==='/session')value={sessionId:'session-1'};
  if(path.endsWith('/elements'))value=empty?[]:[{'element-6066-11e4-a52e-4f735466cecf':'element-1'}];
  if(path.endsWith('/displayed'))value=true;
  if(options.method==='DELETE'&&cleanupFailure)return {ok:false,text:async()=>JSON.stringify({value:{error:'unknown'}})};
  return {ok:true,text:async()=>JSON.stringify({value})};
 };
 return {calls,execute:createAppiumExecutor({request})};
}
test('Appium scopes session to explicit device and cleans up',async()=>{
 const f=fixture(),r=await f.execute(input);
 assert.equal(r.exitCode,0);assert.equal(r.sessionCleanupVerified,true);
 assert.equal(JSON.parse(f.calls[0].body).capabilities.alwaysMatch['appium:udid'],'device-1');
 assert.ok(f.calls.some(c=>c.path.endsWith('/click')));
 assert.equal(f.calls.at(-1).method,'DELETE');
});
test('missing element and failed cleanup block success',async()=>{
 for(const options of [{empty:true},{cleanupFailure:true}])assert.equal((await fixture(options).execute(input)).exitCode,1);
 assert.throws(()=>createAppiumExecutor({endpoint:'http://example.com:4723'}));
});
