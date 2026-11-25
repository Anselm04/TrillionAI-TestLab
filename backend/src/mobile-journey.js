import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const serial=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const pkg=/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+$/;
const digest=/^[a-f0-9]{64}$/;
const actions=new Set(['launch','tapText','assertVisible','assertNotVisible','stop']);
const hash=x=>createHash('sha256').update(x).digest('hex');

export function validateJourney(input){
 if(!input||typeof input.id!=='string'||!id.test(input.id)||typeof input.packageName!=='string'||!pkg.test(input.packageName)||!Array.isArray(input.steps)||input.steps.length<3||input.steps.length>100)throw new Error('Invalid journey');
 const steps=input.steps.map((step,i)=>{
  if(!step||!actions.has(step.action))throw new Error('Unsupported journey action');
  const needsText=['tapText','assertVisible','assertNotVisible'].includes(step.action);
  if(needsText&&(typeof step.text!=='string'||!step.text.trim()||step.text.length>200||/[\x00-\x1f\x7f]/.test(step.text)||step.text.includes('${')))throw new Error('Invalid selector text');
  if(!needsText&&step.text!==undefined)throw new Error('Unexpected selector');
  if((step.action==='launch'&&i!==0)||(step.action==='stop'&&i!==input.steps.length-1))throw new Error('Invalid lifecycle order');
  return needsText?{action:step.action,text:step.text}:{action:step.action};
 });
 if(steps[0].action!=='launch'||steps.at(-1).action!=='stop'||!steps.some(s=>s.action.startsWith('assert')))throw new Error('Journey requires launch, assertions and stop');
 return {id:input.id,packageName:input.packageName,steps};
}

// JSON is valid YAML; exact text is escaped as a regular expression for Maestro.
function exact(text){return '^'+text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$';}
export function compileMaestro(input){
 const journey=validateJourney(input);
 const commands=journey.steps.map(s=>{
  switch(s.action){
   case 'launch':return 'launchApp';
   case 'stop':return 'stopApp';
   case 'tapText':return {tapOn:{text:exact(s.text)}};
   case 'assertVisible':return {assertVisible:{text:exact(s.text)}};
   case 'assertNotVisible':return {assertNotVisible:{text:exact(s.text)}};
  }
 });
 return JSON.stringify({appId:journey.packageName})+'\n---\n'+JSON.stringify(commands)+'\n';
}

// Domain-separated canonical execution plan for Appium; preserve existing Maestro digests.
export function compileExecutionPlan(input,engine='maestro'){
 if(engine==='maestro')return compileMaestro(input);
 if(engine==='appium')return JSON.stringify({schemaVersion:1,engine:'appium',journey:validateJourney(input)});
 throw new Error('Unsupported execution engine');
}

// The execution callback belongs to the trusted supervisor, not the customer.
// Its observations must never be treated as independent or signed verification.
export async function executeJourney({journey,deviceId,buildSha256,execute,engine='maestro'}){
 const plan=validateJourney(journey);
 if(typeof deviceId!=='string'||!serial.test(deviceId)||typeof buildSha256!=='string'||!digest.test(buildSha256)||typeof execute!=='function')throw new Error('Invalid execution context');
 const flow=compileExecutionPlan(plan,engine);
 let result;
 try{result=await execute({deviceId,packageName:plan.packageName,flow});}
 catch{return {journeyId:plan.id,deviceId,buildSha256,engine,flowSha256:hash(flow),status:'INFRASTRUCTURE_ERROR',deploymentAuthorized:false};}
 const output=typeof result?.output==='string'?result.output:'';
 let status='INFRASTRUCTURE_ERROR';
 if(result?.timedOut===true)status='TIMEOUT';
 else if(!result?.error&&!result?.outputTruncated&&Number.isInteger(result?.exitCode)&&result.exitCode>=0&&result.exitCode<=255&&typeof result?.output==='string'&&output.length>0)status=result.exitCode===0?'COMMAND_SUCCEEDED':'COMMAND_FAILED';
 return {journeyId:plan.id,deviceId,buildSha256,engine,flowSha256:hash(flow),outputSha256:hash(output),status,exitCode:result?.exitCode??null,independentReview:'PENDING',deploymentAuthorized:false,productionReady:false};
}
