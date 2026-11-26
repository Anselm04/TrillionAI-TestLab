# TrillionAI TestLab — factual evidence reporting contract

**Purpose: execute tests and provide verifiable observations. No predictions, guarantees, safety percentages or product certifications.**

Every customer-facing test record must state:
1. Exact project/source revision or explicit **unknown revision**.
2. Specific test command or procedure and the relevant environment.
3. Observed exit status, timestamps, logs and evidence availability.
4. Whether the test passed, failed, timed out, could not execute, or suffered infrastructure failure.
5. Concrete reproduction instructions and an evidence-backed explanation of failures.
6. Scope limitations and the tests that have not run.

## Status definitions
- **PASSED**: named test command completed successfully according to its reported exit code; this does NOT mean that the product is safe or defect-free.
- **FAILED**: named test command completed unsuccessfully; investigation determines whether the issue is with the product, test, or environment.
- **TIMEOUT**: execution exceeded the allowed deadline; not a passing test.
- **INFRASTRUCTURE_ERROR**: testing infrastructure could not properly execute or report; not a finding against the customer product.
- **NOT_EXECUTED**: a planned test did not run. Explain the reason.

AI analysis is commentary. It must not overwrite the tool-produced execution observation. Suspected findings remain suspected until corroborated. Repeated runs must retain their individual outcomes: a later pass must never erase an earlier failure.

## Integrity
A checksum detects changes to a report given the original trusted checksum. A standalone checksum does NOT prove origin, prevent a privileged operator from rewriting history, or replace a signed attestation. Signed immutable evidence will require a dedicated later implementation and threat-model review.

Local workspace reports explicitly record `sourceRevision.status: UNKNOWN` because the initial runner mounts a mutable working directory rather than a verified immutable revision. These results must not be treated as qualification of a specific Git commit. Stored report retrieval checks the report ID and checksum; missing reports return 404, while unavailable or inconsistent reports return 503. The Flutter saved-report view reopens a report by its exact ID without executing tests again. It validates the returned report shape and identity, displays the observed command outcome and revision limitation, and does not treat checksum metadata as a signature. The coverage-summary helper checks the presence of all declared categories and nonblank evidence references; references alone are not independent proof of execution.

## Public repository and sensitive information
The current Phase 1 runner captures terminal output into local JSON reports. Do not feed it production secrets, personal records, or untrusted third-party projects. Sanitization and separate secure evidence retention are prerequisites to supporting real customers.

## Release boundary
TestLab does not guarantee functionality, approve production deployments, modify customer code, or perform software repairs. TestLab is strictly a tester. It reports only what it actually observes. The customer or their chosen independent builder performs fixes externally and supplies a new revision for a separate retest. See TESTER_ONLY_CONTRACT.md.
