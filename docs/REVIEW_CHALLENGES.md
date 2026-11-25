# Reviewer challenges

The trusted reviewer issues a short-lived challenge before execution, bound to device, APK and compiled flow digests. Pass its challengeId as reviewChallengeId to MobileReviewOrchestrator. The evidence manifest includes that identifier and its digest is signed by the worker. Configure the review callback with createReplayProtectedReviewer, using a reviewer-owned protected SQLite database and pinned worker public key. Consumption is atomic and evidence run IDs cannot be reused. Expired or consumed challenges require a new execution. A response lost after consumption fails closed.

This prevents reuse of an unchanged signed manifest, not fabrication by a compromised worker. Reviewer transport authentication, key custody, retention and hardware qualification remain separate. Never permit customer workloads to access signing keys or the challenge database. No deployment authorization is granted.
