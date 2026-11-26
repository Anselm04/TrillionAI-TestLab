# Runtime dependency independence

Status: owner-approved architecture requirement; implementation and qualification pending.

TestLab shall own independently maintained, versioned implementations of the Init Executor and, where required, the Scraper Executor, behind explicit compatibility contracts. Examine lawfully accessible upstream behavior and documentation; preserve applicable licenses and notices for any reused code, and do not incorporate restricted proprietary code. Prefer independent implementations with documented provenance.

- Pin engine, executor, build toolchain and transitive dependencies; build reproducible, immutable container images from reviewed source. Record digests, SBOMs and provenance; retain approved rollback artifacts.
- Do not rely on mutable tags or availability of discontinued external executor images. Maintain a documented offline/local build and cluster-loading path.
- Version adapters and validate engine/executor compatibility before every upgrade. Test old and proposed versions in isolated CI; verify initialization, known pass/fail workloads, logs, artifacts, cancellation, timeouts, identity, isolation and independent Kubernetes evidence.
- Monitor upstream releases and security advisories; stage updates rather than automatically promoting them. Block release on failed compatibility, security or license gates. Maintain rollback and supported-version policy. No claim of universal future compatibility.
- Keep the orchestration backend independent of the engine and use replaceable execution adapters. No paid infrastructure or production rollout without authorization.

Immediate priority: specify and implement a compatible Init Executor for the pinned Testkube v1.16.0 contract, then qualify the Scraper Executor as needed. Do not merge the current qualification branch before required checks pass.
