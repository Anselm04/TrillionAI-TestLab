import {validateJourney} from './mobile-journey.js';
const elementKey='element-6066-11e4-a52e-4f735466cecf';
const id=/^[A-Za-z0-9._:-]{1,128}$/;
// Trusted, dedicated loopback Appium server; no customer-controlled endpoint.
export function createAppiumExecutor({endpoint='http://127.0.0.1:4723',request=fetch}={}){
 const url=new URL(endpoint);
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!['/','/wd/hub','/wd/hub/'].includes(url.pathname))throw Error('Dedicated loopback Appium required');
 const base=url.href.replace(/\/$/,'');
 return async ({journey,deviceId,packageName})=>{
  const plan=validateJourney(journey);
  if(!id.test(deviceId)||plan.packageName!==packageName)throw Error('Invalid Appium context');
  let session,failed=false,cleanup=false;const observations=[];
  const deadline=Date.now()+210000;
  async function call(method,path,body,closing=false){
   const remaining=closing?15000:Math.min(15000,deadline-Date.now());
   if(remaining<=0)throw Error('Journey deadline exceeded');
   const r=await request(base+path,{method,redirect:'error',signal:AbortSignal.timeout(remaining),headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const raw=await r.text();if(raw.length>262144)throw Error('Response exceeds limit');
   const value=JSON.parse(raw).value;
   if(!r.ok||value?.error)throw Error('Appium command failed');
   return value;
  }
  try{
   const created=await call('POST','/session',{capabilities:{alwaysMatch:{platformName:'Android','appium:automationName':'UiAutomator2','appium:udid':deviceId,'appium:appPackage':packageName,'appium:noReset':true,'appium:autoLaunch':false,'appium:newCommandTimeout':30},firstMatch:[{}]}});
   session=created?.sessionId;if(typeof session!=='string'||!id.test(session))throw Error('Invalid session');
   const root='/session/'+encodeURIComponent(session);
   for(const step of plan.steps){
    if(step.action==='launch'||step.action==='stop')await call('POST',root+'/appium/device/'+(step.action==='launch'?'activate_app':'terminate_app'),{appId:packageName});
    else{
     // JSON string literal escapes the text for the UiSelector expression.
     const elements=await call('POST',root+'/elements',{using:'-android uiautomator',value:'new UiSelector().text('+JSON.stringify(step.text)+')'});
     if(!Array.isArray(elements)||elements.length>100)throw Error('Invalid element response');
     const visible=[];
     for(const item of elements){
      const e=item?.[elementKey];if(typeof e!=='string'||!id.test(e))throw Error('Invalid element id');
      if(await call('GET',root+'/element/'+encodeURIComponent(e)+'/displayed')===true)visible.push(e);
     }
     if(step.action==='assertNotVisible'&&visible.length!==0||step.action==='assertVisible'&&visible.length===0||step.action==='tapText'&&visible.length!==1)throw Error('Assertion or selector failed');
     if(step.action==='tapText')await call('POST',root+'/element/'+encodeURIComponent(visible[0])+'/click',{});
    }
    observations.push({action:step.action,status:'OBSERVED'});
   }
  }catch{failed=true;}
  finally{if(typeof session==='string'&&id.test(session)){try{await call('DELETE','/session/'+encodeURIComponent(session),undefined,true);cleanup=true;}catch{}}}
  return {exitCode:failed||!cleanup?1:0,output:JSON.stringify({engine:'appium',observations,sessionCleanupVerified:cleanup}),sessionCleanupVerified:cleanup};
 };
}
