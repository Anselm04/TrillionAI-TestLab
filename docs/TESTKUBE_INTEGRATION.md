# Testkube integration foundation

TestLab owns its control plane and evidence model. Testkube is a replaceable execution adapter, not a mandatory dependency.

Pinned upstream: https://github.com/kubeshop/testkube/tree/10a4281347cc677912a527bec34caa79880f87af
Reference: https://github.com/Anselm04/Testkube-Source-Code-Reference/commit/51697966d39ee714c7e5ef9d6dadb8fd92f2b444

The reference manifest reports 2,989 copied files and 79 exclusions. The snapshot is mixed-license upstream-derived material and is not a qualified runnable distribution. No third-party source or binaries are bundled by this change.

## Required gates before activation

1. Produce file-level and transitive dependency license inventory, preserve notices, exclude TCL and uncertain components unless separately authorized. Review the exact standalone agent build and image contents.
2. Verify reproducible builds, image digest, SBOM and provenance; prove standalone execution without commercial control plane or paid services.
3. Implement transport through an operator-managed isolated worker; validate request schema, authorization, tenant binding, deadlines, quotas, egress denial and cleanup. No arbitrary public code or production secrets.
4. Map actual execution logs, exit status, environment and artifact digests to TestLab evidence; missing or unverifiable evidence is UNTESTED or infrastructure error, never PASS.
5. Validate offline contract tests and trusted sample execution on local infrastructure before enabling. Keep existing Docker runner intact.
6. Scale through durable queues, independently scalable workers, HCIE partitioning and evidence aggregation. No capacity claims without measurement.

TestLab remains tester-only: no repairs, deployments or certification. Return defects to external builders. No paid infrastructure or live billing authorized by this change.
