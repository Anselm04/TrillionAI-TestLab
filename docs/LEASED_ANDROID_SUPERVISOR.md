# Leased Android supervisor

Use a protected local SQLite database shared by all trusted supervisors on one dedicated host. The supervisor registers only approved device IDs, acquires a durable lease, checks and renews ownership before and after each fixed ADB command, and releases only after a successful smoke run and verified package cleanup. Failed or uncertain runs quarantine the device. No recovery endpoint is exposed.

This is not a hardware-level fencing mechanism: direct ADB access must be restricted to the trusted supervisor, and a command already running cannot be revoked by a database check. Use bounded command execution and dedicated USB isolation. Cross-host coordination, authenticated maintenance, APK identity verification, actual UI tests and full reset verification remain outstanding. CI uses synthetic ADB responses and does not certify physical hardware or production readiness.
