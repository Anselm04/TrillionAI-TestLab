// TestLab's public capability contract. This is a declaration; runtime enforcement
// also requires immutable source mounts and separate sandbox privilege controls.
export const TESTLAB_ROLE = 'TESTER_ONLY';
export const ALLOWED_OPERATIONS = Object.freeze([
  'SUBMIT_REVISION',
  'RUN_TESTS',
  'READ_TEST_RESULTS',
  'READ_EVIDENCE',
  'RETEST_REVISION',
  'CANCEL_TEST_RUN'
]);
export const FORBIDDEN_OPERATIONS = Object.freeze([
  'EDIT_CUSTOMER_SOURCE',
  'REPAIR_CUSTOMER_CODE',
  'BUILD_CUSTOMER_PRODUCT',
  'PUSH_CUSTOMER_REPOSITORY',
  'DEPLOY_CUSTOMER_PRODUCT',
  'CERTIFY_CUSTOMER_PRODUCT'
]);
export function authorizeProductOperation(operation) {
  return { authorized: ALLOWED_OPERATIONS.includes(operation), operation };
}
