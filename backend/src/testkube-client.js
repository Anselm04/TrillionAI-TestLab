import { randomUUID } from 'node:crypto';
const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const idPattern = /^[a-zA-Z0-9-]{1,128}$/;
const statuses = Object.freeze({queued:'QUEUED',running:'RUNNING',passed:'ENGINE_REPORTED_PASS',failed:'ENGINE_REPORTED_FAIL',aborted:'ABORTED',timeout:'TIMEOUT',skipped:'NOT_EXECUTED'});
export function createTestkubeClient({origin, approvedTests, timeoutMs=10000}={}) {
  const url = new URL(origin);
  if(url.protocol!=='http:' || url.hostname!=='127.0.0.1' || !url.port || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw Error('Loopback Testkube origin required');
  if(!Array.isArray(approvedTests)||!approvedTests.length||approvedTests.some(x=>typeof x!=='string'||!namePattern.test(x))) throw Error('Approved test names required');
  if(!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000) throw Error('Invalid request deadline');
  const names=new Set(approvedTests);
  async function request(path,method='GET',body) {
    const response=await fetch(url.origin+'/v1'+path,{method,redirect:'error',signal:AbortSignal.timeout(timeoutMs),headers:{'accept':'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok){await response.body?.cancel();throw Error('Testkube HTTP request failed');}
    const reader=response.body.getReader();let length=0;const chunks=[];
    try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1048576)throw Error('Response limit');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function result(value,expectedName,expectedId,executionName) {
    const status=value?.executionResult?.status;
    if(typeof value?.id!=='string'||!idPattern.test(value.id)||value.testName!==expectedName||value.name!==executionName||(expectedId&&value.id!==expectedId)||!Object.hasOwn(statuses,status)) throw Error('Unverified execution response');
    return {engine:'testkube-v1.16.0',executionId:value.id,testName:expectedName,executionName,status:statuses[status],engineStatus:status,observedAt:new Date().toISOString(),productionReady:false,independentlyVerified:false};
  }
  return Object.freeze({
    async submit(testName){
      if(!names.has(testName))throw Error('Test not approved');
      const executionName='testlab-'+randomUUID();
      return result(await request('/tests/'+testName+'/executions','POST',{name:executionName}),testName,null,executionName);
    },
    async inspect({testName,executionId,executionName}){
      if(!names.has(testName)||typeof executionId!=='string'||!idPattern.test(executionId)||typeof executionName!=='string'||!/^testlab-[a-f0-9-]{36}$/.test(executionName))throw Error('Invalid execution reference');
      return result(await request('/executions/'+executionId),testName,executionId,executionName);
    }
  });
}
