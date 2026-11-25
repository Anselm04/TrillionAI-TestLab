# Mobile review orchestration

MobileReviewOrchestrator wraps the trusted leased Android supervisor and evidence store. It requires successful execution, verified cleanup, released lease, complete checksum evidence and the expected device/build/journey/flow before requesting a signed independent review. The worker holds only its own private key; the review callback must be operated separately. The orchestration verifies the reviewer signature and returns EVIDENCE_REVIEWED, never production readiness or deployment authorization.

The callback transport, key provisioning, independently issued run IDs, durable replay protection and assertion-level independent review are still required for production use. Offline tests use synthetic reports and ephemeral keys. No hardware, paid service or deployment is required.
