# Device farm operations

Configure TESTLAB_DEVICE_ALLOWLIST with dedicated Android serials and TESTLAB_DEVICE_DB with a protected local SQLite database path. The authenticated GET /device-farm endpoint returns only allowlisted device inventory and lease status. It does not register or allocate devices. The Flutter local dashboard can inspect the endpoint. Keep the API on loopback or behind an authenticated TLS boundary. Unconfigured or unavailable hardware is explicitly reported, not considered verified.

Use loadServiceKey for operator-provisioned Ed25519 key files on separate worker and reviewer service accounts. Private files must be owned by the service account and inaccessible to group and other users. Parent directories must be trusted. Never commit keys or accept paths from jobs. Key rotation, service transport and multi-host orchestration remain outstanding. No paid services are required.

The dashboard is read-only. CI includes Flutter analysis and mocked-HTTP widget fixtures, including Android/iOS inventory filtering, availability/quarantine counts, and clearing stale inventory after an unavailable refresh. These checks do not establish native platform builds, physical device execution or production readiness.
