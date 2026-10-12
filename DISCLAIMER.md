# AI-generated software: risk, audit status, and disclaimer

**Publisher disclosure: the suigate implementation is 100% AI-generated. This release is experimental and has NOT passed an independent human security audit.** Third-party dependencies retain their own authorship, licenses, and security properties; this disclosure is not a claim about how those dependencies were created.

AI-generated code, tests, examples, comments, and documentation may contain mistakes, hallucinated behavior or assumptions, vulnerabilities, or incomplete safeguards. Passing automated tests, successful builds, dependency scans, testnet transactions, and AI-assisted reviews are **not** a human audit or evidence that funds and keys are safe.

## Assume the risk of loss

Use this software entirely at your own risk. It can cause irreversible loss of funds, tokens, private keys, recovery material, credentials, data, access, or profits, including through incorrect or hallucinated code. Safeguards and warnings can themselves be incorrect or incomplete.

**Do not entrust real funds, valuable keys, or production systems to this unaudited release.** Use isolated test-only wallets with no mainnet assets. Testnet does not protect mainnet assets controlled by the same leaked key. Never paste private keys or seed phrases into this project, its configuration, or an AI conversation.

## No warranty; limitation of responsibility and liability

THE SOFTWARE, INCLUDING CODE, CONTRACTS, TOOLS, EXAMPLES, TESTS, AND DOCUMENTATION, IS PROVIDED **AS IS** AND **AS AVAILABLE**, WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, NON-INFRINGEMENT, ACCURACY, SECURITY, OR FREEDOM FROM ERRORS.

**TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE PUBLISHER, AUTHORS, AND CONTRIBUTORS ASSUME NO RESPONSIBILITY AND DISCLAIM LIABILITY FOR ANY CLAIM, DAMAGE, OR LOSS ARISING FROM OR RELATED TO THIS SOFTWARE OR ITS USE OR INABILITY TO BE USED, INCLUDING LOSS OF FUNDS, PRIVATE KEYS, RECOVERY MATERIAL, CREDENTIALS, DATA, ACCESS, BUSINESS, OR PROFITS, WHETHER CAUSED BY BUGS, VULNERABILITIES, INCORRECT OR HALLUCINATED CODE, OR OTHERWISE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH LOSS.**

## License

The suigate code is licensed under the MIT License in `LICENSE.md`. This risk disclosure does not add restrictions to the permissions granted by that license. Third-party dependencies retain their own licenses. The license does not establish that the software has been audited or is safe to use.

## Current machine-readable status

- `aiGenerated: true`, `aiGeneratedPercentage: 100`
- `experimental: true`
- `humanAuditStatus: "not-audited"`
- `humanAuditReport: null`, `auditedRevision: null`
- `recommendedUse: "testnet-only"`
- `lossOfFundsPossible: true`, `lossOfKeysPossible: true`

The canonical runtime notice/status is in `packages/core/risk.mjs` and is exported by `@suigate/core` and `@suigate/core/risk`. The same status is advertised in agent discovery and OpenAPI. Package NOTICE/README files are generated from this document and that canonical notice.

`--acknowledge-unaudited` acknowledges deployment risk only. It does **not** make the software audited or safe, establish legal enforceability, bypass the wallet/network/gas checks, or replace the interactive deployment confirmation. There is no environment switch that marks this release as audited.

## Installation warnings are best-effort

A print-only npm postinstall hook emits the notice. It does not access wallets, make network requests, collect telemetry, or prompt for secrets. npm may hide dependency lifecycle output unless `--foreground-scripts` is used; `--ignore-scripts` and other package-manager policies can suppress it entirely. Do not enable scripts just to see this warning: read the packaged NOTICE instead. Absence of an install warning is not evidence of safety.

## Retiring unaudited warnings after human review

A human audit is hoped for, not promised or scheduled. Warnings must remain until maintainers can verify all of the following:

1. Qualified humans reviewed an identified release/commit, its Move bytecode/source and upgrade assumptions, wallet/CLI handling, authentication, adapters, examples, dependency configuration, and relevant operational boundaries.
2. A report records the exact scope, revision, findings, remediation, residual risks, and reviewer sign-off. Any unreviewed surface must remain identified as such.
3. Material findings are resolved and independently rechecked; builds and tests are reproducible. Additional wallet-approved validation does not substitute for review.
4. Maintainers explicitly update the canonical audit status, link the report, identify the audited revision, regenerate packaged notices, and revise the relevant UI/CLI/discovery flags and tests in the same reviewed release change.
5. Later material changes receive appropriate review; an audit of an earlier revision does not automatically cover later releases.

An audit does not guarantee security or recovery of losses. Remove or revise only warnings contradicted by the documented review. **Retain accurate AI-generation provenance and appropriate no-warranty/liability language after an audit.** Never relabel an old unaudited artifact as audited retroactively.
