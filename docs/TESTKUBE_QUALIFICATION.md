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

Status: functional and security qualification passed for the tested build. Production release, binary redistribution and final licensing clearance remain blocked pending review of the distribution notice/source package. No production activation or general security certification is implied.
