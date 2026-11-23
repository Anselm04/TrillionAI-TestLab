# TestLab sandbox and agent architecture

## Current Phase 2 scaffold

The repository contains a real, limited Docker-based **Node.js test runner**, along with a policy contract, adapter registry and failure-category coverage model. It **does not yet provide a PTY, an AI agent, microVM isolation, a universal command runner, or certified production readiness**.

## Proposed execution layers

1. **Flutter owner console**: observe jobs and terminal logs, cancel sessions, inspect evidence.
2. **Node.js/TypeScript control plane**: authenticated job admission, policy enforcement, durable scheduling and accounting.
3. **Isolated worker boundary**: disposable VM/microVM for untrusted code; Docker inside worker for disposable test services.
4. **Agent terminal service**: PTY spawned *inside the guest*, never the host. Host control plane uses a narrow, authenticated command broker.
5. **Pluggable verification adapters**: detect technology, list supported capabilities, execute actual tests, provide verifiable artifacts.
6. **Independent release assessor**: fail closed for missing coverage, unsupported environments, or failed security checks.

## Important design choices

- Never mount Docker socket, SSH keys, cloud tokens, or host home directories into a customer worker.
- Block outbound network by default; dependency installation needs a controlled, auditable mirror or approved egress.
- Per-session CPU, memory, file system, process, command, network and spending budgets are enforceable by infrastructure, not AI instructions.
- Every agent command records intent, command arguments, stdout/stderr, timestamps, exit code and source revision. Secrets are redacted before retention.
- Any code changes remain inside an ephemeral workspace until separately approved and reviewed.
- TestLab cannot certify its own test results based exclusively on agent statements.
- The current sandbox-policy module limits Phase 1 operations to the existing node-test adapter. **It is a policy scaffold, not a kernel sandbox.**
- In a later phase, use guest-isolated PTY sessions and automated teardown. Do not give an LLM an unrestricted host shell.

## Future integration contracts (not yet live)

- `POST /v1/jobs`: immutable source revision, requirements, adapter, environment, cost authorization.
- `GET /v1/jobs/:id`: lifecycle, execution status and failure details.
- `GET /v1/jobs/:id/evidence`: immutable test evidence and signed attestation.
- `POST /v1/jobs/:id/cancel`: cancel and destroy guest resources.
- Agent action: `run_tool(session_id, tool_id, typed_args)` with independent policy enforcement.

The AppForge repair agent may consume evidence and submit a **new revision**. Manager may coordinate jobs but cannot override test verdicts.

## Next execution milestone

Provision a disposable Linux guest, execute a real terminal command inside the guest, verify failed-command capture, enforce limits, and prove teardown after errors and timeouts. Add reliable CI tests that demonstrate isolation and cleanup before accepting untrusted source.
