import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assessAccessibility} from '../src/accessibility-testing.js';
const revisionSha256='a'.repeat(64),environmentId='browser',journeyId='login';
const node={id:'submit',role:'button',name:'Submit',visible:true,enabled:true,keyboardReachable:true,requiresKeyboard:true};
const step={id:'tab1',expectedNodeId:'submit',actualNodeId:'submit',focusVisible:true};
const snapshot={revisionSha256,environmentId,journeyId,evidenceId:'run1',complete:true,nodes:[node],keyboardSteps:[step]};
const args={revisionSha256,environmentId,journeyId,snapshot,verifyEvidence:async()=>true};
test('verified declared checks do not imply WCAG conformance or human usability',async()=>{
 const r=await assessAccessibility(args);assert.equal(r.status,'DECLARED_RULES_PASSED');assert.equal(r.wcagConformance,'NOT_ESTABLISHED');assert.equal(r.humanUsability,'NOT_ASSESSED');
});
test('detects missing names, inaccessible keyboard controls and invisible focus',async()=>{
 const r=await assessAccessibility({...args,snapshot:{...snapshot,nodes:[{...node,name:' ',keyboardReachable:false}],keyboardSteps:[{...step,focusVisible:false}]}});
 assert.equal(r.status,'VERIFIED_RULE_FINDINGS');assert.deepEqual(r.findings.map(f=>f.rule),['ACCESSIBLE_NAME_MISSING','KEYBOARD_UNREACHABLE','FOCUS_INDICATOR_NOT_OBSERVED']);
});
test('partial and unverified observations never pass',async()=>{
 assert.equal((await assessAccessibility({...args,snapshot:{...snapshot,complete:false}})).status,'INCOMPLETE');
 assert.equal((await assessAccessibility({...args,snapshot:{...snapshot,nodes:[],keyboardSteps:[]}})).status,'INCOMPLETE');
 assert.equal((await assessAccessibility({...args,verifyEvidence:async()=>false})).status,'UNVERIFIED');
 await assert.rejects(assessAccessibility({...args,snapshot:{...snapshot,nodes:[node,node]}}));
});
test('wrong context and unknown focus target rejected',async()=>{
 await assert.rejects(assessAccessibility({...args,snapshot:{...snapshot,environmentId:'other'}}));
 await assert.rejects(assessAccessibility({...args,snapshot:{...snapshot,keyboardSteps:[{...step,actualNodeId:'unknown'}]}}));
});
