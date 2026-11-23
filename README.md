# TrillionAI TestLab

**Product boundary: testing and factual evidence reporting only.** TestLab does not create, repair, edit, deliver, deploy or certify customer software. Customers return identified defects to their own builder, then resubmit a new revision for retesting. See [Tester-Only Contract](docs/TESTER_ONLY_CONTRACT.md).

Independent, local-first software testing laboratory for TrillionAI products and, eventually, externally supplied applications.

## Current scope: Phase 1 prototype

The initial implementation runs Node.js built-in tests against a **trusted, local** project directory inside a restricted Docker container; records JSON evidence; exposes an authenticated local API; and includes a basic Flutter client.

**Not production-ready and not a universal certification system yet.** A passing test suite does not establish complete functional, security, integration, infrastructure, or deployment readiness. The runner has not been approved to execute untrusted public code.

### Architecture

- `backend/src/server.js`: loopback-only Node.js HTTP API (requires TESTLAB_TOKEN)
- `backend/src/core.js`: workspace-safe path selection, isolated Docker runner, persistent evidence
- `backend/test/core.test.js`: runner and path validation tests
- `backend/test/e2e.mjs`: starts real API, invokes Docker, verifies sample tests and evidence retrieval
- `frontend/lib/main.dart`: Flutter dashboard for submitting a test job and viewing the JSON report
- `examples/node-sample`: deterministic sample app used for test verification
- `.github/workflows/ci.yml`: free-tier-friendly GitHub hosted checks on pushes and PRs

## Quickstart (trusted source code only)

Prerequisites: Node.js 22+, Docker Engine. Flutter 3.24+ SDK is optional.

```bash
git clone https://github.com/Anselm04/TrillionAI-TestLab.git
cd TrillionAI-TestLab
cd backend
npm test
export TESTLAB_TOKEN="$(openssl rand -hex 32)"
npm start
```

In another terminal:

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS -X POST http://127.0.0.1:8787/runs \
  -H "Authorization: Bearer $TESTLAB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"project":"node-sample"}'
```

For sample projects stored elsewhere set `TESTLAB_WORKSPACE_ROOT` to an absolute path before starting the API. Reports go to `backend/reports/` unless `TESTLAB_REPORT_ROOT` is provided.

On a Linux machine with Docker, the repository integration check can be executed as:

```bash
TESTLAB_TOKEN="$(openssl rand -hex 32)" node backend/test/e2e.mjs
```

The Flutter UI is an initial client only; it requires a reachable local API with valid token and is not yet configured as a production web/mobile build.

## Critical isolation and cost limitations

- Docker hardening is **not** adequate isolation against deliberately malicious repositories. Do not allow untrusted code until VM/microVM workers, outbound network isolation, resource and time quotas, and strong cleanup are engineered and independently verified.
- The runner disables container networking, uses a read-only project mount, drops privileges and Linux capabilities, enforces CPU/memory limits, and records evidence.
- No secrets or real production access should ever be supplied to a test workspace.
- GitHub Actions does not deploy anything. CI uses standard hosted runners; applicable GitHub usage limits still apply.
- This prototype recognizes `PASSED`, `FAILED`, `TIMEOUT`, and `INFRASTRUCTURE_ERROR`. A passing suite is **not** production approval.

## Expansion plan

1. Durable job queue, SQLite/PostgreSQL persistence, artifact retention, immutable commit imports, failure recovery.
2. Strongly isolated workers and coverage contracts for Flutter, Node.js, Python, web apps and databases.
3. Real browser/mobile/API E2E testing, security scans, permission isolation, payments sandbox, load and fault testing.
4. Repeatable requirements-to-test traceability and tamper-evident factual reports; no release approval or guarantees.
5. Pluggable language/application adapters (including games, desktop, mobile, SaaS, infrastructure and AI agents), with clear *unsupported/untested* results until their test adapters are validated.

Every adapter must report the exact environment, supported test capabilities, evidence and known omissions. **UNTESTED is never PASS.**
