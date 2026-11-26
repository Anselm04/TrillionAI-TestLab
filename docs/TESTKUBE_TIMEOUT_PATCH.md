# TestLab-maintained Testkube timeout correction

Upstream baseline: kubeshop/testkube commit `45dc266f4d502b1a91e036fad1f24e569bb1d6c5` (v1.16.0). Its original tree is `e734070a9f0df684fa03c5b15c819d7e3f4aa725`; the unpatched embedded tree is `44096f901c33cd34554521babe3e7706a7d35160` (only Slack integration documentation omitted).

The container executor previously mapped an expired Kubernetes workload to a generic failure. The TestLab patch changes `pkg/executor/containerexecutor/containerexecutor.go` and adds `deadline.go` and `deadline_test.go`. It waits briefly for the original Job's terminal condition, validates the Pod's controller identity, and classifies only `Failed=True` with `DeadlineExceeded` as timeout. Final persistence follows log parsing so a log-derived failure cannot replace that status. Existing upstream license notices are retained.

Qualification still requires observed Kubernetes deadline enforcement, independent exit-code and overlap verification, cancellation, security scans, and licensing review. This patch does not activate production execution or establish release readiness.

Dependency remediation is a separate TestLab-maintained change to `go.mod` and `go.sum`. The candidate was resolved and built in GitHub Actions run `45797674993` with Go 1.27.4; its artifact SHA-256 is `9f186d006406459263141b3a4160e5676c3a7c94274a0f78ebe21f9bcec4b8ff`. The exact verified lockfiles are incorporated; the integration workflow rebuilds and rescans them before clearance.
