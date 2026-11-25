# Durable device leases

Node.js 22.13+ with built-in SQLite. Use a protected local database on a single host, shared by trusted supervisor processes. Register only dedicated approved devices. BEGIN IMMEDIATE serializes allocation; fencing counters and opaque tokens prevent stale lease mutation. Expiry quarantines rather than automatically reallocating hardware. Cleanup must be independently verified before release. Quarantine recovery is deliberately unavailable pending authenticated maintenance.

This is a persistence foundation, not a distributed scheduler or a hardware fencing mechanism. AndroidWorker is not yet wired to it; no cross-host guarantees, tenant isolation, or automatic crash recovery are claimed. A trusted supervisor must enforce leases on every hardware command before enabling parallel workers. Do not place SQLite on network storage. Offline tests use temporary databases; no device, paid service or deployment is required.
