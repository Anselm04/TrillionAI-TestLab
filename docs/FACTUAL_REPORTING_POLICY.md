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

The authenticated read-only `GET /runs/compare/{beforeId}/{afterId}` endpoint compares two saved local-runner reports for the same project and named check. It returns both observed statuses, flags changed execution context, and explicitly declines to establish source revision or environment equivalence. The Flutter dashboard accepts both report IDs and displays the individual outcomes and limitations without rerunning tests. Neither interface alters reports or establishes that a defect was repaired.

## Integrity
A checksum detects changes to a report given the original trusted checksum. A standalone checksum does NOT prove origin, prevent a privileged operator from rewriting history, or replace a signed attestation. Signed immutable evidence will require a dedicated later implementation and threat-model review.

Independent local checksum review is available using `node scripts/verify-local-report.mjs REPORT_DIRECTORY REPORT_ID RETAINED_SHA256`. The expected digest must come from an independently retained record, not the current report itself. The command reads one bounded saved report, validates its checksum and observation contract, reports a match or explicit failure, and never outputs raw test logs or executes a test. Exit status 0 means the retained digest matched; it is not a test-pass result or verification of origin. Exit status 1 indicates missing, mismatched or unavailable evidence; 2 indicates invalid input.

The signed mobile release-evidence assessment evaluates a detached policy and evidence snapshot, hashes that policy before asynchronous artifact verification, and passes a separate manifest copy to the verifier. Successful verification means the stated evidence checks passed for the supplied context; it is not production approval or proof that physical devices were used. The offline cross-platform fixture remains synthetic.

Local report publication writes and synchronizes a private staging file before atomically linking it at the final report ID, with no replacement of an existing report. Readers never see partial staged content. An interrupted process may leave an ignored temporary file; this is local Linux filesystem durability, not replicated or cryptographically immutable storage.

Local report reads and writes are bounded to 4 MiB per JSON file. Oversized records are not silently truncated or treated as valid evidence; stored oversized files are unavailable through the report API. This is a per-record bound, not a total storage quota or verified multi-tenant capacity limit. A bounded local fixture qualifies 128 independent report publications with four concurrent writes at a time and checks every retained outcome and checksum; it does not measure customer workload throughput.

Priority 4 storage qualification: `node --test test/report-storage-qualification.test.js` performs 32 sequential publish-and-read cycles with 128 KiB synthetic output per report and a 100 ms interval, then rechecks every original digest and outcome. It emits elapsed time, stored bytes, measured p95 publish/read latency and sampled process RSS. One local observation on Node 24.22.3 recorded 3,297 ms, 4,224,704 stored bytes, 6.34 ms p95, and 51,150,848 bytes sampled peak RSS. These are fixture observations, not a throughput target or long-duration/multi-customer qualification. Timings vary with hardware and concurrent work.

Local workspace reports explicitly record `sourceRevision.status: UNKNOWN` because the initial runner mounts a mutable working directory rather than a verified immutable revision. These results must not be treated as qualification of a specific Git commit. Stored report retrieval checks the report ID and checksum; missing reports return 404, while unavailable or inconsistent reports return 503. The Flutter saved-report view reopens a report by its exact ID without executing tests again. It validates the returned report shape and identity, displays the observed command outcome and revision limitation, and does not treat checksum metadata as a signature. The coverage-summary helper checks the presence of all declared categories and nonblank evidence references; references alone are not independent proof of execution.

## Public repository and sensitive information
The current Phase 1 runner captures terminal output into local JSON reports. Do not feed it production secrets, personal records, or untrusted third-party projects. Sanitization and separate secure evidence retention are prerequisites to supporting real customers.

## Release boundary
TestLab does not guarantee functionality, approve production deployments, modify customer code, or perform software repairs. TestLab is strictly a tester. It reports only what it actually observes. The customer or their chosen independent builder performs fixes externally and supplies a new revision for a separate retest. See TESTER_ONLY_CONTRACT.md.
