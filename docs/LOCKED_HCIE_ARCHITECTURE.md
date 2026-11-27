# LOCKED ARCHITECTURE — Hierarchical Code Intelligence Engine (HCIE)

## Permanent TestLab mission

TrillionAI TestLab is strictly a software **tester and factual evidence reporter**. It does not repair, build, deploy, certify or guarantee customer software. The Hierarchical Map-Reduce Analysis Engine is its **core source-understanding architecture**, designed to support enormously large repositories without depending on an AI model seeing every source file at once.

## Non-negotiable properties

1. **Whole-repository accounting:** enumerate exact submitted revision, every file, size, digest, language/type, submodule and excluded/unreadable path. Silent omission is forbidden.
2. **Deterministic chunking:** bounded units of code; preserve file identity, exact byte/line ranges, hashes and symbol links. Record overlap where needed for context.
3. **Map stage:** analyse individually retrievable chunks. An LLM may help interpret, but no model observation is itself proof of correctness or defect.
4. **Hierarchical reduction:** combine evidence references and structured findings from chunks to files, modules, subsystems and one report. Use bounded fanout and persistent storage; preserve all original references and contradictions.
5. **Reverse traceability:** every reported fact links back to the exact revision, source material, test procedure, logs and executed observations. Reopen original sources when summaries conflict.
6. **No lossy final authority:** summaries are navigation aids, not source-of-truth. A final synthesized conclusion cannot upgrade an untested area to passed or assert a feature is absent merely because retrieval failed.
7. **Separate coverage axes:** inventoried/indexed/analysed source, executed tests, supported runtime environments and requirements coverage must be distinct. 100% indexing does NOT mean 100% testing.
8. **Durable, resumable processing:** process datasets in partitions with checkpointing, bounded worker queues, incremental reanalysis on changed files and dependency-aware invalidation.
9. **Scale by resources, not marketing claims:** target tens of millions to hundreds of millions of lines, 45,000+ files and beyond using sharded stores and workers. Do NOT promise unlimited size: capacity is bound by hardware, quotas, storage, duration and supported tools. Report intake limits and incomplete runs exactly.
10. **Tester-only:** generated test scripts and disposable fixtures stay outside submitted customer source. Findings return to the customer's chosen builder; a new revision is separately retested.
11. **Fail-closed evidence:** any omission, inconsistency, read error, unavailable environment or truncated output remains visible; never invent results, percentages or guarantees.

## Planned real system (not yet implemented)

- Streaming repository snapshotter with content-addressed object storage and symlink/submodule safety.
- Language-aware parser-backed chunker with stable IDs and oversize-file fallbacks.
- Search and symbol/reference graph, persistent indexed metadata and chunk retrieval.
- Durable map-work queues, checkpointed assessments, multi-level reduction and reverse investigation.
- Independent E2E sandbox execution and a factual report writer that links to real test artifacts.
- Horizontal worker scaling, quotas, customer isolation, cancellation and incremental retests.

## Currently implemented seed

`backend/src/hcie.js` implements an **in-memory deterministic inventory and evidence-link hierarchy** that rejects malformed inventory entries, source-hash mismatches and duplicate IDs; propagates incomplete analysis; and preserves references during bounded grouping. Regression tests demonstrate 45,000-entry partitioning and multi-level analysis reconciliation. This is NOT yet a 25-million-line streaming ingestion engine, an LLM map worker, a persistent database, or a universal test orchestrator.

## Acceptance milestones

Inventory qualification evidence: the persistent inventory regression stores 45,000 synthetic metadata entries in batches of 200, reopens the database midway, reconciles an independently computed manifest, and confirms 45,000 indexed entries and 4,500,000 declared bytes. A separate fixture exits its writer process before orderly close, reopens the database, and verifies that committed entries are retained without duplication. Inventory sealing also reports explicit status counts, known byte totals as decimal strings, and unknown-size counts. These are local metadata-storage checks, not source-byte processing, full HCIE analysis, multi-tenant throughput or billion-line qualification.

- Inventory and checkpoint a large multi-language repository with provable file and chunk accounting.
- Recover after interruption without losing evidence or claiming the interrupted part was analysed.
- Demonstrate reverse lookup from the final report to original immutable bytes and test observations.
- Identify known intentionally distributed features and distinguish missing versus undiscovered implementation.
- Prove massive-repo processing under explicitly recorded resource budgets, without changing customer code.
- Execute actual applicable tests independently and report measured outcomes and unavailable tests separately.

Architectural change requires an explicit decision and corresponding regression tests; this document is the authoritative design contract for future HCIE work.
