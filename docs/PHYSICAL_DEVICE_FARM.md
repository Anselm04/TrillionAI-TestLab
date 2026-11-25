# Physical device farm — approved architecture

TestLab remains a tester, not a builder or deployment service. Device tests supplement hierarchical code analysis and sandbox tests. No hardware purchases, paid providers, production payments or artificial social engagement are authorized.

## Implemented foundation
- Local ADB inventory discovery with a fixed command; hardware kind is unverified.
- Single-process exclusive leases; expired devices remain quarantined pending cleanup.
- Coverage gate that blocks absent, failed or malformed evidence. Even complete declared coverage requires independent evidence review; never authorizes deployment.
- Unit tests using synthetic ADB output, not physical-device test evidence.

## Integration sequence
1. Dedicated isolated Android worker with explicit device allowlist, verified hardware metadata, restricted network, test APK digest, bounded commands, reset and cleanup attestation.
2. Persistent, tenant-scoped leases with fencing, heartbeat and crash recovery; no concurrent access to a device.
3. Appium/Maestro and Flutter integration-test adapters; collect actual assertions, screenshots, logs, video and metrics. Use sandbox identities and payments.
4. macOS worker and XCUITest for owned iOS devices; browser and emulator adapters remain separately classified.
5. Independent evidence verification against immutable artifact hashes, signed worker identities, required test matrix and exact build digest. The current gate only checks metadata shape and cannot authenticate evidence or reviewers.
6. Integrate reports with existing TestLab API and Flutter UI, then an explicit release approval workflow external to TestLab.
7. Hardware qualification and real-device execution when hardware is available. Missing devices or requirements remain NOT_EXECUTED; no production readiness claim.

The initial device pool is in-memory and not suitable for multi-worker or hostile workloads. Do not attach personal devices or expose ADB to public networks. Identical boards improve concurrency, not compatibility coverage. Human usability and applicable store testing obligations remain separate.
