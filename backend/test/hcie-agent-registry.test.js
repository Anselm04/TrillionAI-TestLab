import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HcieAgentRegistry} from '../src/hcie-agent-registry.js';
import {runRegisteredMapWorkerOnce} from '../src/hcie-registered-worker.js';
const digest=x=>x.repeat(64);
function setup(){
 const registry=new HcieAgentRegistry();
 registry.register({agentId:'analyzer',role:'ANALYZER',definitionSha256:digest('a'),implementation:async()=>({status:'ANALYZED',summary:'observation'})});
 registry.register({agentId:'reviewer',role:'REVIEWER',definitionSha256:digest('b'),implementation:async r=>({accepted:true,observationSha256:r.observationSha256,chunkSha256:r.scope.descriptor.chunkSha256,reviewerId:'spoofed',reviewerDefinitionSha256:digest('f')})});
 const policySha256=registry.approve({analyzerId:'analyzer',reviewerId:'reviewer',executionPolicySha256:digest('c')});
 registry.seal();return {registry,policySha256};
}
test('registry binds policy and supplies reviewer identity rather than trusting callback',async()=>{
 const {registry,policySha256}=setup(),pair=registry.resolve(policySha256);
 const scope={policySha256,descriptor:{chunkSha256:digest('d')}};
 assert.equal((await pair.analyze({scope})).status,'ANALYZED');
 const r=await pair.review({scope,observationSha256:digest('e')});
 assert.equal(r.reviewerId,'reviewer');assert.equal(r.reviewerDefinitionSha256,digest('b'));assert.equal(r.accepted,true);
 await assert.rejects(pair.analyze({scope:{policySha256:digest('f')}}),/scope policy/);
 assert.throws(()=>registry.resolve(digest('f')),/Unapproved/);
 assert.throws(()=>registry.register({}),/sealed/);
});
test('unsealed and non-independent registrations fail closed',()=>{
 const r=new HcieAgentRegistry(),fn=async()=>({});
 r.register({agentId:'a',role:'ANALYZER',definitionSha256:digest('a'),implementation:fn});
 assert.throws(()=>r.register({agentId:'b',role:'REVIEWER',definitionSha256:digest('b'),implementation:fn}),/Duplicate/);
 r.register({agentId:'b',role:'REVIEWER',definitionSha256:digest('a'),implementation:async()=>({})});
 assert.throws(()=>r.approve({analyzerId:'a',reviewerId:'b',executionPolicySha256:digest('c')}),/Independent/);
 assert.throws(()=>r.resolve(digest('a')),/Sealed/);
});
test('unapproved worker policy fails before any task claim',async()=>{
 const {registry}=setup();let claims=0;
 await assert.rejects(runRegisteredMapWorkerOnce({registry,policySha256:digest('f'),queue:{claim(){claims++;},complete(){}}}),/Unapproved/);
 assert.equal(claims,0);
});
