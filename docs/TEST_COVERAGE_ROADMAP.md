# TestLab capability expansion and factual coverage

TestLab's priority is trustworthy, repeatable **testing**, never building, repairing or deploying submitted products.

## Capability states

- `NOT_IMPLEMENTED`: no executable, validated adapter.
- `PARTIAL`: some executable checks exist, but broad domain coverage is not established.
- `NOT_EXECUTED`: an available or planned test has not run against the submitted revision.
- `PASSED` / `FAILED`: one named executed check, supported by machine-collected evidence.
- `TIMEOUT` / `INFRASTRUCTURE_ERROR`: inability to complete a valid test observation.

The `backend/src/capability-registry.js` module is the machine-readable inventory. It intentionally advertises only Node.js built-in tests as currently executable.

## Expansion order, based on risk and dependencies

1. **Worker trust boundary:** guest-isolated execution, immutable submitted revision, sandbox teardown, no production secrets, immutable evidence retention.
2. **Evidence quality:** separate stdout and stderr, command/exit status, tool/version attestations, tamper-evident signatures, checks against intentionally faulty fixtures.
3. **Functional:** real browsers and mobile devices, contract tests, event and database integration, user journey test manifests.
4. **Security:** access control, authentication, API misuse, injection, secrets, dependency advisories, and supply chain provenance.
5. **Data and financial correctness:** concurrency, idempotent payments, isolation, migrations, retention and recovery.
6. **Resilience:** disruption, retry, network partitions, restoration, backup verification and resource exhaustion.
7. **Performance:** load, stress and long-duration tests with reproducible resource budgets and measurements.
8. **Cross-platform:** Flutter, Android, iOS, desktop, games, services and additional language families.
9. **Test-quality calibration:** mutation testing, known-bad fixture suites, flaky test detection, independent reproductions and regression comparisons.
10. **Agent-assisted testing:** read-only application analysis, generated test scripts in isolated test workspace, and prioritized exploratory testing that never changes submitted source.

Each adapter must first prove it can detect intentionally failing cases as well as passing ones. Do not announce a capability until real CI execution and tests support that specific claim.

## Product boundaries

TestLab returns observed findings and reproduction steps to the customer. Their builder may repair an application externally; TestLab retests the next submitted revision. No automated repair, deployment, release approval or software guarantees. No risk probability figures.

## Cost control

Continue with open-source tools and ordinary public-repository CI checks. Large stress tests, external platforms, cloud test devices and paid AI models require bounded budgets and explicit authorization before usage.
