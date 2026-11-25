import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runDockerLifecycle} from '../src/docker-lifecycle.js';
import {classifyExecution} from '../src/evidence.js';
const name='testlab-12345678-1234-1234-1234-123456789abc';
const args=['run','--rm','--name',name,'node:22-alpine','node','--test'];
const ok={status:'COMMAND_SUCCEEDED',exitCode:0,terminationConfirmed:true,output:'',outputTruncated:false};
test('default lifecycle verifies removal after command completion',async()=>{
 const calls=[];
 const result=await runDockerLifecycle(args,{execute:async c=>{calls.push(c.args);return ok;}});
 assert.equal(result.cleanupVerified,true);assert.equal(classifyExecution(result).status,'PASSED');
 assert.deepEqual(calls[1],['rm','--force',name]);assert.equal(calls[2][0],'ps');
});
test('timeout still triggers scoped cleanup and remains timeout',async()=>{
 const result=await runDockerLifecycle(args,{execute:async c=>c.args[0]==='run'?{...ok,status:'TIMEOUT',exitCode:null}:ok});
 assert.equal(result.cleanupVerified,true);assert.equal(classifyExecution(result).status,'TIMEOUT');
});
test('daemon failure, remaining container and truncated inventory cannot pass',async()=>{
 for(const listing of [{...ok,status:'COMMAND_FAILED',exitCode:1},{...ok,output:name},{...ok,outputTruncated:true}]){
 const result=await runDockerLifecycle(args,{execute:async c=>c.args[0]==='ps'?listing:ok});
 assert.equal(result.cleanupVerified,false);assert.equal(classifyExecution(result).status,'INFRASTRUCTURE_ERROR');
 }
});
test('unconfirmed execution and invalid names fail closed',async()=>{
 const result=await runDockerLifecycle(args,{execute:async c=>c.args[0]==='run'?{...ok,terminationConfirmed:false}:ok});
 assert.equal(classifyExecution(result).status,'INFRASTRUCTURE_ERROR');
 await assert.rejects(runDockerLifecycle(['run','--name','other'],{execute:async()=>{assert.fail('must not run');}}));
});
