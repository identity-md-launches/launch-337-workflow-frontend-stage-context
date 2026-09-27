# Frontend validation

Worker validation for the Happy Hour frontend on 2026-09-27. This evidence is a local engineering report, not independent verification, deployment approval or publication certification.

## Scope and assumptions

Implemented a small English-language page for the deployed native ETH/HAPY pool: UTC block clock, fee/countdown, accrued amounts per currency, donation review, wallet/network handling, exact-input swaps and their approvals, event observability, explorer links and provenance. Chose a light paper/terracotta design with system fonts. No contracts, Solidity tests, root configuration or original ABI exports were modified. No contracts were deployed and no real transactions were signed or broadcast.

Read the supplied workflow, deployment, network, Better Interface entry/reference and both protected Solidity test inputs. The protected tests describe existing contract requirements; they were not edited or rerun for this frontend-only change. ABI bytes were obtained from the exact deployed source commit and their hashes verified.

The overriding write scope excludes root `DESIGN.md`. The complete implemented design document is therefore [docs/DESIGN.md](DESIGN.md), and this scope conflict is explicitly disclosed. Only the explicitly allowed `web/.gitignore` was added; it ignores generated directories at every nesting level beneath `web/`.

## Commands and outcomes

Run from the repository root unless noted:

| Command | Outcome |
| --- | --- |
| `npm --prefix web ci --offline --cache "$PWD/web/.cache" --no-audit --no-fund` | Pass: installed 536 packages from the worker cache using the committed lockfile |
| `npm --prefix web run build` | Pass: includes `tsc --noEmit`, Vite production export, pinned ABI checks and manifest generation |
| `npm --prefix web test` | Pass: 7 tests for ABI binding, fee boundaries, input/slippage limits, decoded router settlement, unknown-chain addition, wallet identity and safe paths |
| `PLAYWRIGHT_BROWSERS_PATH="$PWD/test/scratch/browsers" npm --prefix web run test:browser` | See [browser-results.json](frontend/browser-results.json): production export served at `/preview/`, mocked interaction checks plus a separate unmocked public-RPC browser read |
| `npm --prefix web run validate:export` | Pass: final asset bytes, manifest inventory, exact handoff fields/network, pinned ABI arrays and canonical hashes |
| From `web/`: `NODE_USE_ENV_PROXY=1 node --import tsx scripts/live-check.mjs` | Pass: read-only chain/code/metadata/hook/pool checks against the configured public RPC |

The build emits a nonfatal >500kB JavaScript-chunk advisory. The total export is below 0.7 MB; there are six inventoried assets plus the manifest. The original workspace Git metadata is read-only: `git add` failed creating `.git/index.lock`. A disposable staging checkout produced a complete-history Git bundle below 1.5 MB, well under the 8 MiB limit; no original-workspace commit is claimed. The input history initially lacked two ancestor blobs. They were retrieved from the public handoff repository and restored by exact Git object hash in the disposable checkout only. Bundle verification and restoration into a clean checkout passed. No source maps, fonts, external runtime image dependencies, caches, dependency archives or node_modules are exported. Precise final export metrics and scope checks are in [delivery-check.json](frontend/delivery-check.json).

`npm ci` emits a transitive React peer warning from the unused optional-wallet SDK dependency graph; typecheck/build and tested wagmi injected-wallet behavior pass. `npm audit` reports 22 moderate and one high finding in the installed dependency graph, including older `ws` under WalletConnect/Reown packages. The app imports wagmi's injected connector directly, configures only injected/EIP-6963 wallets and HTTP RPC, and does not initialize those optional SDKs. `npm audit fix` did not resolve the remaining graph without a wagmi major upgrade. No claim of a clean dependency/security audit is made; reassess before enabling additional connector types.

## Deployment binding and export

- Source: `af9fc67005a96c6b19fa60c756943e3743bffeac`.
- LaunchToken canonical ABI Keccak: `f36d2fe28b62f817a4fba0b78bb501b41895eada3982280273c063ad8183f577`.
- HappyHourHook canonical ABI Keccak: `3f3f2df52073a13bf2ab6d3befa4d3ca9497e5b8e6a743bb02285f155ae67b51`.
- `web/scripts/export.mjs` verifies raw ABI export bytes against `git show` at the pinned commit before copying them to `dist/abi/`. The app fetches the same manifest and arrays at runtime and rejects changed ABI content.
- Every address, chain ID, public RPC, pool setting and token identity used by the app derives from `dist/imd-deployment.json`. The supplied network and wallet-add-chain objects are preserved unchanged as JSON values. No secret or private RPC setting is present.
- Asset paths are relative. The exporter inventories all files except itself, hashes final bytes, rejects symlinks, requires `index.html`, enforces 128 assets and 8 MiB per file, and applies an additional 8 MiB export cap. The tested page loaded at a nested `/preview/` path.
- Publication, immutable CID/named-gateway checks and hosted RPC checks are future control-plane work and are not asserted here.

## Browser and interaction evidence

The supplied MCP browser tool returned `Transport closed`. A local Playwright 1.56.1 Chromium 141 browser was successfully installed and used in a bounded foreground script that owns and closes its HTTP server/browser. It renders the final static export, not the Vite development page. No mock is shipped in `dist/`.

Automated scenarios cover disconnected reads, connected balances, keyboard connection, wrong network, unknown-chain switch/add/switch, missing wallet, donation cancel, simulated revert without signature, wallet rejection, successful mocked receipt, zero-accrual refresh, no in-range liquidity, validation focus, ETH input without approvals, two bounded HAPY approvals, both swap receipts, minimum output, quote invalidation/expiry, missing deployed code, failed RPC recovery, delayed RPC reads, and tampered ABI startup. See the machine-readable list for the precise final results. Wallet signatures, RPC responses and receipts in those scenarios are fixtures, not live-chain executions.

Rendered screenshots were opened and inspected during the worker review:

- [Desktop, connected fixture](frontend/desktop.png): 1440×1000 viewport, full page.
- [Keyboard focus](frontend/focus-desktop.png): 1440×1000, focused Connect wallet ring.
- [390px mobile](frontend/mobile-390.png): full page.
- [320px reflow](frontend/mobile-320.png): full page.
- [Actual public-RPC page](frontend/live-desktop.png): disconnected wallet, real Sepolia view state, no fixture balances.

Also checked the 768px intermediate layout and 200% root-text enlargement for horizontal overflow. Desktop/mobile axe checks cover WCAG 2 A/AA, 2.1 AA and 2.2 AA tags with zero violations in the tested populated states. Browser failures and console exceptions are recorded. These checks do not prove full accessibility conformance.

The separate read-only RPC snapshot at block **11,791,497** reported a **100 bps** hook fee, `isHappyHour=false`, **34,788 seconds** to the next change, zero accrued ETH/HAPY and zero in-range liquidity. Token decimals/symbol matched 18/HAPY and configured code was nonempty. The later live-browser check records its own block in the JSON evidence. Historical observations do not promise later liquidity or successful swaps.

## Better Interface review: all six domains

| Domain | Coverage and evidence | Limitations |
| --- | --- | --- |
| Accessibility | Checked semantic headings/landmarks, skip link, labeled form, native buttons/details, selected states, validation linkage/focus, status/alert regions, visible keyboard ring, desktop/mobile axe scans and 320px reflow. | No screen-reader session or physical touch device. Keyboard connection and form focus exercised; not every flow was completed keyboard-only. |
| Layout | Checked shared edges, panel hierarchy, DOM reading order, 1440/768/390/320 widths, disclosure affordances, address/error wrapping rules, 200% text enlargement. Screenshots inspected. | Native browser zoom and translated/RTL variants untested; only English is implemented. |
| Writing | Reviewed action labels against handlers, pool versus hook fee distinction, gas-only donation consequence, JIT explanation, quote minima/expiry, approval steps, empty/stale/error reasons and recovery. | Wallet extension's own confirmation wording is outside this page. |
| Typography | Checked serif/sans hierarchy, actual rendered wrapping, selectable text, tabular digits, 16px+ inputs and full-value disclosure. No font requests occur. | Cross-platform system-font differences untested. |
| Colors | Measured actual computed foreground/background pairs; corrected clock-caption contrast; tested text statuses and automated contrast checks. | Only the supplied light presentation reviewed; forced-colors styles are source-reviewed, not manually rendered. |
| UI | Checked card/control states, disabled prerequisites, selected direction, donation review/cancel, quote/approval progression, empty/error/loading behavior, 120ms transitions and reduced-motion media guard. | Screenshots use reduced motion. Non-reduced-motion timing was source-reviewed, not replayed in an animation inspector. |

Measured final pairs, from browser-computed styles: clock secondary text on warm panel **5.125:1**, primary button text **5.545:1**, secondary body text on page **5.706:1**, and donation heading on card **13.748:1**. See exact RGB pairs in `browser-results.json`.

## Findings, corrections and rechecks

| Severity | Source | Finding, fix, evidence |
| --- | --- | --- |
| Medium | `web/src/style.css:10` | Initial muted caption on the warm clock panel measured 4.480:1 and failed axe. Changed shared secondary ink from `#686b61` to `#5f6259`. Rechecked rendered contrast at 5.125:1 and clean desktop/mobile axe scans. |
| Medium | `web/src/App.tsx:96` | Browser test showed an invalid amount did not regain focus while the form fieldset was disabled. Moved focus to an effect after the busy state clears, and applied `aria-invalid` to the specific failing field. Rechecked invalid-amount interaction successfully. |
| Medium | `web/src/App.tsx:471` | Source/layout review found transaction feedback after both panels could place donation errors below the whole mobile swap form. Moved the stable feedback area above the cards and scroll signing errors into view. Rechecked donation rejection/revert flows and mobile screenshots. |
| Medium | `web/src/state.ts:167` | Source review found a fixed interval could supersede every snapshot if RPC reads took longer than 15 seconds. Schedule the next poll only after completion, retain cancellation generations and block stale transactions. Rechecked with an 18-second sequential read fixture. |
| Medium | `web/src/App.tsx:157` | Signing can follow a slow simulation after displayed eligibility has changed. Directly recheck wallet account/chain and read freshness after simulation; swap execution additionally checks quote expiry and input identity. Rechecked simulation rejection, quote expiry and unit wallet identity guards. |
| Low | `web/src/App.tsx:102` | The countdown originally kept extrapolating after the clock's 45-second cap. Applied the same cap to both and kept stale labels/transaction gates. Reviewed final source and stale quote behavior. |

No unresolved observed functional or rendered blocker remains for the assigned frontend. Build warnings/dependency audit observations and the write-scope conflict are documented above.

## Completion and remaining limits

Source, export and validation evidence are complete for the stated allowed frontend scope. Committing in the original workspace is blocked by its read-only `.git` directory. Design documentation is relocated to `docs/DESIGN.md` to obey the overriding path restriction. Build/typecheck, protocol tests, production-browser interactions, deployment/asset binding and read-only live RPC checks have been run. Evidence is worker-produced and carries no independent network authority.

No funded live donation, approval or swap was performed. No independent contract audit, real wallet-extension integration across vendors, screen-reader session, native 200% browser zoom, physical-device test, IPFS pin, named-site publication, or control-plane verification is claimed. The initial live pool had no accrued fees and no active liquidity; donation correctly requires those conditions to change before signing is available.
