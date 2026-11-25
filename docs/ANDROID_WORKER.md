# Android worker

The local Android smoke worker supports explicitly allowlisted dedicated devices, operator-confirmed host isolation, SHA-256 verification of staged APK bytes, package preflight, installation, package presence and cleanup. It returns observations, not a product readiness certificate.

Only trusted operators may invoke it. Do not expose it as a customer API: host isolation and artifact provenance are not enforced by this module. Use disposable dedicated devices and verify APK package identity/signature before invocation. Never run untrusted APKs on personal devices. The device quarantine and busy state are in-memory and require durable fencing before multi-worker use. Unknown installation outcomes require operator cleanup; uninstall does not prove a full device reset. The smoke test does not launch the app or verify user journeys. CI uses fake ADB and does not claim real hardware coverage. No paid services or deployments are needed.
