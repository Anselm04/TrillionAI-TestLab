import { createTraceabilityPlan } from './requirement-traceability.js';

// Proposed initial functional journey based on the stated product scope. This is a checklist, not an
// executable test suite or a claim about the current AppForge repository.
const requirements=Object.freeze([
 ['AF-001','An account can be created with a permitted synthetic identity.'],
 ['AF-002','Account verification completes in a sandbox mail environment.'],
 ['AF-003','A synthetic customer can sign in and sign out.'],
 ['AF-004','The product displays the offered subscription plans.'],
 ['AF-005','A subscription can be created in a simulated billing environment.'],
 ['AF-006','The displayed entitlement and credit balance reflect the test subscription.'],
 ['AF-007','A customer can submit an ordinary application-generation request using a fixture.'],
 ['AF-008','The request displays its lifecycle and progress state.'],
 ['AF-009','The completed fixture output is available to the customer.'],
 ['AF-010','The customer can open and edit the generated fixture project.'],
 ['AF-011','Saved edits remain available when the project is reopened.'],
 ['AF-012','The preview reflects the saved fixture project.'],
 ['AF-013','The project can be exported as supported source artifacts.'],
 ['AF-014','Git export can be rehearsed with a simulated provider.'],
 ['AF-015','Deployment configuration can be reviewed in a dry run without provisioning resources.'],
 ['AF-016','Ordinary validation failures produce understandable user feedback.'],
 ['AF-017','An interrupted fixture job reports its actual state.'],
 ['AF-018','A customer can cancel a sandbox subscription according to its terms.'],
 ['AF-019','The customer can view their synthetic usage and project history.'],
].map(([id,title])=>Object.freeze({id,title})));

export function appForgeQualificationTemplate(){
 return {schemaVersion:1,product:'AppForge',version:1,scope:'INITIAL_FUNCTIONAL_JOURNEY',requirements:requirements.map(r=>({...r,status:'NOT_EXECUTED'})),productionReady:false,deploymentAuthorized:false};
}

// Only a separately supplied immutable revision and independently defined
// test mappings can turn the checklist into a traceability plan.
export function createAppForgeQualificationPlan({revisionSha256,tests=[]}={}){
 return createTraceabilityPlan({revisionSha256,requirements,tests});
}
