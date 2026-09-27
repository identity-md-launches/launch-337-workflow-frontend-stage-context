# Happy Hour frontend

A one-page React + TypeScript + Vite application for the deployed ETH/HAPY Uniswap v4 pool on Sepolia. It provides a block-derived UTC clock, current hook fee, next-change countdown, separate accrued ETH/HAPY balances, permissionless donation review, recent hook events, and exact-input swaps in both directions. Wallet connection uses wagmi's injected/EIP-6963 connectors; no WalletConnect account or private credentials are required.

## Install, build, preview

Use Node 22 and npm 10. From `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run validate:export
npm run preview -- --host 127.0.0.1
```

Dependencies are pinned by `package-lock.json`. With a populated npm cache, installation can use `npm ci --offline --cache .cache`; the build itself needs no network after dependencies are installed. No npm registry mirror or dependency archive is part of the submission. Vite writes `../dist/`, then `scripts/export.mjs` verifies and copies the ABI arrays and writes the final deployment manifest. Never edit generated export files independently: rebuild after changing source.

Vite uses `base: './'`. The page and configuration/ABI fetches resolve relative to the current document, so the export works at a static gateway subpath without server rewrites. Serve the entire `dist/` directory, including its manifest and ABI files. Source publication and IPFS hosting belong to the publisher; this worker does neither.

## Configuration and provenance

`config/deployment.json` and `config/network.json` are retained handoff inputs, copied from the supplied pinned reads. They are build inputs, not a second browser configuration. `dist/imd-deployment.json` is the only runtime address, chain, pool, token and RPC configuration. The browser loads this file and its referenced ABI arrays through `src/config.ts`.

The exporter reads `docs/abi/LaunchToken.json` and `docs/abi/HappyHourHook.json`, compares their bytes with `git show <sourceCommit>:docs/abi/<Contract>.json`, and verifies canonical Keccak-256 against the handoff. Canonical JSON recursively sorts object keys, preserves array order, and uses compact JSON. It retains the exact contract set, addresses, hashes, launch ID, source commit, attestation hash, `network` block and `walletAddChain` parameters. Pool/token metadata is copied into the same runtime manifest. The exporter records lowercase SHA-256 for every other exported file, including both raw ABI arrays and `index.html`. Its `--check` mode recomputes the inventory and checks the manifest against the handoff.

Keep the pinned source commit available in Git when rebuilding. Runtime ABI verification detects disagreement between the manifest and ABI bytes; it is not an independent attestation-signature verifier. Publication verification is a later control-plane step.

Protocol interface fragments for vetted Uniswap contracts are centralized in `src/protocol.ts`; no router/quoter/Permit2 address is embedded there. Every quote, approval and swap uses `manifest.network.uniswapV4`. The production JS contains no independent deployment address map. Public RPC fallback order is exactly the supplied list. There is no backend.

## Reads and actions

- With a 15-second interval after each completed read, reads check RPC chain ID and nonempty bytecode for both deployed contracts and configured Uniswap infrastructure. The hook's PoolManager and token metadata must agree with configuration.
- Hook fee, happy-hour status, seconds-to-change, both accrued balances, liquidity, price, decimals, symbol and connected balances use one block number. The displayed fee comes from `currentFeeBps()`, not a local schedule calculation.
- The UTC clock/countdown interpolate from the observed block using monotonic browser time for up to 45 seconds. Actions pause after 45 seconds, at a fee boundary, on RPC errors, or when the returned block differs from the device clock by more than 180 seconds. An incorrect device clock can therefore require correcting the device time. Refresh retries the public endpoints.
- Recent `FeeTaken` and `Donated` events cover the latest 1,000 blocks in four bounded requests, are filtered to the launch pool, and are refreshed from chain rather than permanently accumulated. The latest six are shown with transaction links. Events are not used to reconstruct balances; reorgs can change them.
- `donateFees(poolKey)` is the hook's public end-user transaction. Review shows both exact amounts, gas responsibility and finality before signing. The caller donates existing hook claims with zero ETH value and receives no reward. Nothing accrued or no in-range liquidity disables donation. Simulation failures leave the fees accrued. In-range LPs added just before the donation share earlier fees (JIT capture).
- Swaps call the vetted quoter with `simulateContract`, apply 0.01–5% user-selected slippage, and encode Universal Router `0x10` with actions `0x060c0f`. Native input sends the exact amount and requires no approval. Token input exposes token approval to Permit2 followed by Permit2 approval to the Universal Router as separate transactions, limited to the entered amount; router permission expires after 30 minutes. Get a fresh quote after each approval. Quotes expire after 30 seconds or at the next fee change. Input, direction, slippage, wallet and chain changes invalidate quotes. The router transaction has a five-minute deadline.
- Every transaction is simulated before requesting a signature. Wallet chain and account are checked directly before and after simulation; state freshness and quote expiry are rechecked before signing. Errors, rejection, submission hash, receipt success and failure are visible. No frontend can prevent the chain changing while a wallet confirmation is open; encoded minimum output and deadline remain the transaction's protection.
- Unknown chains use the exact handoff `wallet_addEthereumChain` parameters after a failed switch, then switch again. Wrong-network controls remain visible. Browser wallets only; WalletConnect would require a separately supplied public project ID and is intentionally not configured.

HAPY's standard ERC-20 transfer utilities and hook callbacks are not additional primary workflows on this pool page. The hook has no admin/owner actions. Providing or removing liquidity is outside this assignment.

## Validation

```sh
npm test
# Install a test browser once (network needed only for this installation).
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../test/scratch/browsers npm run test:browser
NODE_USE_ENV_PROXY=1 node --import tsx scripts/live-check.mjs
```

`test:browser` starts and closes its own foreground HTTP server and Chromium, serves the final `dist/` at `/preview/`, and mocks public RPC plus an injected wallet. It records screenshots and a machine-readable result under `docs/frontend/`. No fixture or mock is included in the production export. Unit tests check attested ABIs, amount validation, hour boundaries, decoded router settlement, minimum output, and wallet network behavior. `live-check.mjs` only makes public RPC reads and records the result; it never submits a transaction.

See [validation evidence](../docs/VALIDATION.md) and [implemented design](../docs/DESIGN.md). Root `DESIGN.md` was not created because the assignment's overriding write scope permits documentation only under `docs/` or `web/`.

## Reference material

Swap encoding follows the supplied workflow and [Uniswap's Universal Router guide](https://developers.uniswap.org/docs/protocols/v4/guides/swapping/swapping). Implementation-derived project interfaces remain the pinned ABI exports. The interface applies the supplied Better Interface guide: Jakub Krehel, MIT, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Design documentation follows Paul Bakaus's Impeccable document method, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`, [source](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md). The guides were used as design references; their source text is not redistributed in the export.
