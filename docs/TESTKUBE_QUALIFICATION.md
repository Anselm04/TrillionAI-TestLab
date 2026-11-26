# Testkube Kubernetes qualification record

Qualification run: [45802648709](https://github.com/Anselm04/TrillionAI-TestLab/actions/runs/45802648709), commit `76723217f8ed7819367e15881a2cc97c0a1cf0ea`. Evidence artifact SHA-256: `194ecaa945cc9db0624cf66655643125ba0e5c80aee86c4695343dfca1d2a81b`.

## Observed results

- Go deadline and route regression tests, API and executor builds, isolated Kubernetes setup, supporting services and engine startup passed.
- Independent workload evidence verified exit codes 0 and 7, overlapping execution, cancellation, and Kubernetes DeadlineExceeded mapped to TIMEOUT.
- govulncheck reported zero affected vulnerabilities in each of the API, init, and scraper binaries. Its additional non-called dependency/package findings are not a claim of universal vulnerability absence.
- Trivy reported zero HIGH or CRITICAL findings in either executor image. SBOMs were generated. Disposable infrastructure was destroyed.

## Licensing inventory and distribution gate

The embedded upstream v1.16.0 source retains its MIT license and executor license files. The linked-module notice inventory contains 133 module entries. A text-based inventory review identified predominantly MIT, Apache-2.0, BSD and ISC-style notices; this is an engineering inventory, not a substitute for license interpretation or a distribution audit.

The one filename missed by the inventory is `github.com/package-url/packageurl-go` v0.1.0. The exact upstream tag resolves to `04e124e0cd98ac01fdf0ebb1a5799e9139a029b7`; its [mit.LICENSE](https://github.com/package-url/packageurl-go/blob/v0.1.0/mit.LICENSE) was inspected and is reproduced in `TESTKUBE_PURL_NOTICE.md`.

The API binary also links `github.com/hashicorp/golang-lru/v2` v2.0.1 (MPL-2.0), tag `6ce8a7443353151a95e1d2d74e0579bd4e5b92e5`. The [MPL-2.0 license](https://www.mozilla.org/en-US/MPL/2.0/) and [corresponding upstream source](https://github.com/hashicorp/golang-lru/tree/v2.0.1) are identified for the distribution review. MPL-covered source availability and license notices must be addressed if binaries are redistributed, alongside the other applicable notice obligations.

## Distribution evidence prepared

The exact run-14 artifact was downloaded and verified against its SHA-256 above. `TESTKUBE_LINKED_NOTICES.txt` contains the indexed full notice texts for all 133 module entries (132 linked dependency versions plus the main module), with a separate Go 1.27.4 notice and the recovered PURL MIT notice. The bundle is reproducible using `scripts/prepare-testkube-notices.mjs` and the run-14 `security-evidence` directory. Its SHA-256 is `82179cbcf39defe3bcf83dcadc34767c40f35493f6ef4a17e1c501ec4d97cc7d`.

`TESTKUBE_IMAGE_LICENSES.tsv` records 58 installed OS package entries (29 per executor image), derived from the exact SBOMs. It identifies, among others, GPL-2.0-only BusyBox, Git and Alpine packages, LGPL alternatives in some system libraries, and MPL-2.0 CA certificates. Its SHA-256 is `954e38b13aa02482d24cff5d2ee1da150a4135b7b6947e44e9b7d0760dd861c3`.

The Go notice bundle is not a complete container distribution package: operating-system corresponding sources, applicable source-delivery arrangements, and final notice placement for each distributed artifact still require verification. See [GPL-2.0 §3](https://spdx.org/licenses/GPL-2.0-only) and [MPL-2.0 §3.2](https://www.mozilla.org/en-US/MPL/2.0/). No image or binary redistribution is authorized by this record.

Status: functional and security qualification passed for the tested build, and the linked-Go notice bundle and OS license inventory are complete. Final distribution licensing clearance remains blocked. The source-only integration may be considered separately from customer artifact redistribution only with the owner's explicit approval; do not interpret this record as permission to publish or activate execution in production.

### Corresponding-source qualification

The upstream and the newer Testkube reference both retain the external Git checkout dependency. Do not remove it merely to simplify licensing. Instead, the CI qualification now captures the installed APK database from each scanned image, matches every package to the SBOM, and maps it to its exact Alpine aports commit and source-package version. The source collector retrieves that pinned recipe and uses Alpine abuild's source-fetch and checksum verification, retaining recipe archives, fetched distfiles, source identities, and SHA-256 checksums. The actual MPL Go module source is copied from the verified module cache. Missing identities, mismatches, source-fetch failures, or artifact limits fail the qualification rather than omitting material. The bounded temporary evidence bundle is not a published customer source-delivery service; review its completeness and prepare durable source delivery before distribution authorization. Do not merge until the remaining engineering gate and review are complete.
