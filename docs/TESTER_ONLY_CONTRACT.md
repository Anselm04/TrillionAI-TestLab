# TrillionAI TestLab — tester-only operating contract

**TestLab is a tester and evidence reporter. It is not a builder, code editor, auto-repair agent, deployment platform, or certifier.** This is a product boundary, not merely an AI prompt.

## Authorized actions

- Import a specific submitted revision into disposable, read-only source storage.
- Configure an isolated test environment and generate test fixtures or test scripts **outside the submitted source tree**.
- Execute real functional, security, integration, compatibility, fault, performance and other applicable tests within available adapters.
- Record what happened, including failures, infrastructure errors, timeouts and tests not executed.
- Return precise observations, logs, input conditions, reproduction instructions, evidence references, coverage gaps and suggested areas for investigation.
- Repeat testing on a **new revision supplied by the customer or an external builder**. Preserve the earlier reports.

## Prohibited actions

- Write, alter or commit changes to submitted customer source code, including through AI-driven terminal commands.
- Generate a replacement customer application or repair build under a testing job.
- Silently push patches, open corrective pull requests in a customer's repository, deliver production artifacts, or deploy an application.
- Describe advice as a confirmed fix or claim software is bug-free, safe, guaranteed, certified, or production-approved.
- Turn an unexecuted test, a suspected finding, or an infrastructure failure into a passing result.

TestLab can generate **test-only** code/scripts and disposable fixtures, so long as they do not alter the submitted product. Some test suites require compilation or runtime-generated files; those must be created in an independent, disposable workspace. Such operations are preparation for testing, **not customer product building or repair**.

## Customer workflow

1. Customer or authorized external builder submits revision A and requirements.
2. TestLab runs applicable tests and reports factual evidence plus gaps.
3. Customer takes the report back to their chosen builder and requests any repairs.
4. Builder produces revision B; customer submits revision B for a new test.
5. TestLab retains reports for A and B separately, showing what changed and what actually passed or failed on each revision.

AppForge can be an *external builder* and Manager can *coordinate submissions*, but **neither may override TestLab observations**. TestLab never fixes code on their behalf.

## Enforcement requirements for future engineering

- Submission source tree remains read-only and integrity checked before and after testing.
- TestLab AI tool broker exposes test-only actions and no customer repository write credentials.
- Environment/fixture writes occur only in an independent disposable work directory.
- Every test result is tied to a submitted immutable revision and explicit environment.
- Reports remain factual: no confidence scores, certifications or guarantees.
- API and integration tests actively verify that mutation, builder, repair and deployment actions are unavailable.
