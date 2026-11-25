import {createHash} from 'node:crypto';
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const sha=/^[a-f0-9]{64}$/;
const valid=(v,r)=>typeof v==='string'&&r.test(v);
const namedRoles=new Set(['button','link','textbox','checkbox','radio','combobox','switch','slider','spinbutton','searchbox']);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Trusted browser adapter supplies computed accessibility information,
// not raw HTML attributes or caller-asserted conformance.
export async function assessAccessibility({revisionSha256,environmentId,journeyId,snapshot,verifyEvidence}={}){
 if(!valid(revisionSha256,sha)||!valid(environmentId,id)||!valid(journeyId,id)||typeof verifyEvidence!=='function'||!valid(snapshot?.evidenceId,id)||snapshot.revisionSha256!==revisionSha256||snapshot.environmentId!==environmentId||snapshot.journeyId!==journeyId||!Array.isArray(snapshot.nodes)||snapshot.nodes.length>10000||!Array.isArray(snapshot.keyboardSteps)||snapshot.keyboardSteps.length>1000||typeof snapshot.complete!=='boolean')throw Error('Invalid accessibility evidence');
 const seen=new Set(),nodes=[];
 for(const n of snapshot.nodes){
  if(!valid(n?.id,id)||seen.has(n.id)||!valid(n.role,id)||typeof n.name!=='string'||n.name.length>4096||typeof n.visible!=='boolean'||typeof n.enabled!=='boolean'||typeof n.keyboardReachable!=='boolean'||typeof n.requiresKeyboard!=='boolean')throw Error('Invalid accessibility node');
  seen.add(n.id);nodes.push({id:n.id,role:n.role,name:n.name,visible:n.visible,enabled:n.enabled,keyboardReachable:n.keyboardReachable,requiresKeyboard:n.requiresKeyboard});
 }
 const steps=[],stepIds=new Set();
 for(const s of snapshot.keyboardSteps){
  if(!valid(s?.id,id)||stepIds.has(s.id)||!seen.has(s.expectedNodeId)||!(s.actualNodeId===null||seen.has(s.actualNodeId))||typeof s.focusVisible!=='boolean')throw Error('Invalid keyboard step');
  stepIds.add(s.id);steps.push({id:s.id,expectedNodeId:s.expectedNodeId,actualNodeId:s.actualNodeId,focusVisible:s.focusVisible});
 }
 const evidence={revisionSha256,environmentId,journeyId,evidenceId:snapshot.evidenceId,complete:snapshot.complete,nodes,keyboardSteps:steps};
 const report=(status,extra={})=>({schemaVersion:1,status,revisionSha256,environmentId,journeyId,evidenceSha256:hash(evidence),...extra,wcagConformance:'NOT_ESTABLISHED',humanUsability:'NOT_ASSESSED',productionReady:false,deploymentAuthorized:false});
 try{if(await verifyEvidence(structuredClone(evidence))!==true)return report('UNVERIFIED',{findings:[]});}catch{return report('UNVERIFIED',{findings:[]});}
 const findings=[];
 for(const n of nodes){
  if(!n.visible)continue;
  if(namedRoles.has(n.role)&&!n.name.trim())findings.push({rule:'ACCESSIBLE_NAME_MISSING',nodeId:n.id,wcag:'4.1.2'});
  if(n.enabled&&n.requiresKeyboard&&!n.keyboardReachable)findings.push({rule:'KEYBOARD_UNREACHABLE',nodeId:n.id,wcag:'2.1.1'});
 }
 for(const s of steps){
  if(s.actualNodeId!==s.expectedNodeId)findings.push({rule:'EXPECTED_FOCUS_NOT_REACHED',stepId:s.id});
  else if(!s.focusVisible)findings.push({rule:'FOCUS_INDICATOR_NOT_OBSERVED',stepId:s.id,wcag:'2.4.7'});
 }
 const gaps=[];
 if(!snapshot.complete)gaps.push('PARTIAL_SNAPSHOT');
 if(!nodes.length)gaps.push('NO_NODES');
 if(!steps.length)gaps.push('NO_KEYBOARD_JOURNEY');
 return report(findings.length?'VERIFIED_RULE_FINDINGS':gaps.length?'INCOMPLETE':'DECLARED_RULES_PASSED',{findings,gaps,nodeCount:nodes.length,keyboardStepCount:steps.length});
}
