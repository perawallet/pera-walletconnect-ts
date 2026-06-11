# WalletConnect v1 Modernization — Design

**Date:** 2026-06-11
**Status:** Approved
**Repo:** pera-walletconnect-ts (fork of WalletConnect v1 monorepo, branch `v1`)

## Goal

Transform the forked WalletConnect v1.8.0 monorepo into a single, modern, security-forward package — `@perawallet/walletconnect@1.0.0` — that retains full WC v1 protocol capability and wire compatibility. Primary consumer: pera-rn (React Native wallet, wallet side). Secondary consumers: pera-connect (`../connect`, dapp side, uses the client class + `IWalletConnectSession` type) and potential future web dapps.

## Context & constraints

- The backend bridge is pinned to WC v1; upgrading to ReOwn's WC v2 walled garden is off the table.
- Upstream WC v1 is dead (unmaintained since ~2022) and all `@walletconnect/*` npm packages are ReOwn-controlled — a supply-chain liability in a wallet's crypto path.
- pera-connect's surface (verified by code analysis): `WalletConnect` default export — constructor (`bridge`, `qrcodeModal`), `createSession({chainId})`, `killSession()`, `sendCustomRequest(req, {forcePushNotification})`, `on("connect")`, `.connected`, `.accounts`, `.bridge` — plus the `IWalletConnectSession` type.
- pera-rn conventions to mirror (verified in `../pera-rn`): pnpm 10.28.1, pnpm catalog, `minimumReleaseAge: 10080`, `.tool-versions` (node 22), oxlint + oxfmt, vitest + coverage-v8, vite + vite-plugin-dts builds, GH Actions: pre-merge / codeql / scorecard / sbom.

## Decisions (settled during brainstorming)

1. **Scope:** Keep wallet-side packages only — client, core, iso-crypto, socket-transport, utils, browser-utils, types. Delete the 9 dapp/Ethereum packages (sdk, qrcode-modal, react-native-dapp, signer-connection, http-connection, ethereum-provider, web3-provider, web3-subprovider, truffle-provider).
2. **External ReOwn micro-deps:** Vendor + modernize. Zero `@walletconnect/*` packages remain in the dependency tree.
3. **Structure:** Single package with subpath exports; internal folders preserve module boundaries.
4. **Name/version:** `@perawallet/walletconnect@1.0.0` — "1" signals WC v1 protocol, fresh 1.0.0 signals a new implementation, not upstream's 1.8.x line.
5. **Approach:** Port + modernize with the original packages kept as devDependency test oracles (golden interop tests).
6. **Publishing:** Public npm via OIDC trusted publishing with provenance (no npm tokens).

## 1. Package shape

Repo stays a (minimal) pnpm workspace; the package lives at `packages/walletconnect`.

```
packages/walletconnect/src/
  client/        ← from clients/client (WalletConnect class, public API)
  core/          ← from clients/core (Connector, EventManager, transport wiring, storage)
  crypto/        ← iso-crypto + vendored @walletconnect/crypto, rebuilt on @noble
  transport/     ← socket-transport
  utils/         ← utils + vendored encoding / jsonrpc-utils / safe-json bits
  browser/       ← browser-utils + vendored window-getters / window-metadata, minimal UA detection
  types/         ← types package (interfaces only, no runtime code)
  index.ts
```

- **Exports map:** `.` (default export = `WalletConnect` class) and `./types`.
- **Build:** vite + vite-plugin-dts, dual **ESM + CJS**. Metro (RN 0.85) resolves the exports map; pera-connect consumes ESM; CJS is the compatibility fallback.
- **No Node built-ins, no `Buffer`** — `Uint8Array` everywhere. One artifact serves RN, browser, Node.
- **Public API frozen:** all WC v1 client API — constructor options (`bridge`, `qrcodeModal`, `session`, `storage`, `clientMeta`, `signingMethods`, ...), `createSession`, `approveSession`, `rejectSession`, `killSession`, `approveRequest`, `rejectRequest`, `sendCustomRequest`, `updateSession`, all events, `.connected`, `.accounts`, `.bridge`, `.peerMeta`, etc.

## 2. Dependency modernization

| Legacy | Replacement |
|---|---|
| `@walletconnect/crypto` | Vendored, rewritten on `@noble/ciphers` (AES-256-CBC) + `@noble/hashes` (HMAC-SHA256). Randomness exclusively from `crypto.getRandomValues`. |
| `bn.js` + `js-sha3` | `BigInt` + `@noble/hashes` keccak; existing util function signatures kept |
| `query-string` | `URLSearchParams` |
| `@walletconnect/encoding`, `safe-json`, `jsonrpc-utils`, `window-getters`, `window-metadata` | Vendored internal modules (each <100 lines); license attribution preserved |
| `detect-browser` | Vendored minimal UA detection (web `clientMeta` defaults only) |
| `ws@7.5.3` | Global `WebSocket` in browser/RN; `ws@^8` as **optional peer dependency** for Node consumers |

**Resulting runtime dependencies: `@noble/ciphers`, `@noble/hashes`.** Nothing else.

### Wire compatibility (hard constraint)

Byte-identical protocol behavior with WC v1.8.0:
- Encrypted payload format `{data, hmac, iv}` (hex), AES-256-CBC + HMAC-SHA256 over `cipher + iv`
- JSON-RPC 2.0 framing, `wc_sessionRequest`/`wc_sessionUpdate` methods, payload id generation semantics
- Bridge socket message format (`{topic, type: "pub"|"sub", payload, silent}`)
- URI format `wc:{topic}@1?bridge={url}&key={hex}`

Proven by the interop test suite (section 4), not assumed.

## 3. React Native posture

- `crypto.getRandomValues` is a documented hard requirement; constructor throws a clear error if absent. pera-rn satisfies it via `react-native-quick-crypto` (already pinned there); `react-native-get-random-values` also works.
- Session persistence injectable via existing `storage` / `session` constructor options. Web default: `localStorage`. RN: consumer passes an AsyncStorage/MMKV adapter.
- All `window` / `document` / `location` access behind safe getters returning `undefined` off-web (upstream behavior preserved).

## 4. Testing

- Port existing specs (core, client, socket-transport, utils, iso-crypto, browser-utils) to **vitest** with `@vitest/coverage-v8`.
- **Mock v1 bridge**: minimal in-repo ws server implementing the v1 pub/sub bridge protocol, used as a hermetic test utility. CI never touches the production bridge.
- **Golden interop suite** — original `@walletconnect/client@1.8.0` + `@walletconnect/crypto@1.x` as devDependencies (test oracle):
  - Crypto round-trips in both directions: old encrypts → new decrypts; new encrypts → old decrypts; HMAC verification cross-checks.
  - Committed fixed test vectors (key/iv/plaintext/ciphertext/hmac) so compatibility survives even after the oracle devDeps are eventually removed.
  - Full dapp↔wallet session lifecycle, old client on one side and new on the other (both orientations) over the mock bridge: connect → approve → custom request (incl. `forcePushNotification`) → session update → kill.

## 5. Tooling, CI & supply-chain hardening

Mirroring pera-rn:

- **pnpm 10.28.1** (`packageManager` field), `pnpm-workspace.yaml` with `minimumReleaseAge: 10080` (7-day dependency cooldown), `.npmrc` as needed, `.tool-versions` pinning node 22
- **TypeScript 5.9 strict**, **oxlint** (+ type-aware checks) and **oxfmt**
- **GitHub Actions** (all actions pinned by commit SHA; least-privilege `permissions:` per workflow):
  - `pre-merge.yml`: frozen-lockfile check, `pnpm audit`, oxlint, oxfmt check, typecheck, build, vitest with coverage
  - `codeql.yml`: security-extended query pack
  - `scorecard.yml`: OpenSSF Scorecard, weekly
  - `sbom.yml`: CycloneDX SBOM via syft, weekly + on push to main

### Publishing hardening (OIDC)

- **npm Trusted Publishing via OIDC**: release workflow authenticates with GitHub's OIDC token. No npm tokens exist anywhere — nothing to leak or rotate. npm enforces that publishes originate from this exact repo + workflow.
- **Provenance** (`npm publish --provenance`): Sigstore attestation linking each published artifact to its commit and workflow run, publicly verifiable on npmjs.com.
- Release workflow is **tag-triggered and environment-gated** (GitHub environment with required reviewers); `id-token: write` granted only in the publish job.
- Packaging safety: `files` allowlist (only `dist/` + license/readme), `prepack` build, **publint** + tarball-content check in CI.
- npm package settings: token publishing disabled; trusted publisher is the only publish path.

## 6. Deletions

- The 9 dapp/Ethereum packages
- `example/` dapp
- lerna, `lerna.json`, npm `package-lock.json`, `npm-run-all`, legacy publish/`scripts/` plumbing (health-check, move-dist, commit-version)
- eslint 5 toolchain and configs (replaced by oxlint/oxfmt)

## Error handling notes

- Missing `crypto.getRandomValues`: explicit constructor-time error with remediation hint.
- Transport: preserve upstream reconnect/backoff semantics in socket transport; queued messages flush on reconnect (existing behavior, covered by ported tests).
- Storage: tolerate absent/broken storage (in-memory fallback) exactly as upstream did; malformed persisted sessions are discarded via safe JSON parsing.

## Success criteria

1. `@perawallet/walletconnect@1.0.0` builds (ESM+CJS+types) and passes lint/typecheck/tests in CI.
2. Interop suite green in both orientations against original 1.8.0 packages.
3. Runtime dep tree is exactly `@noble/ciphers` + `@noble/hashes`.
4. pera-connect compiles against it with only an import rename (`@walletconnect/client` → `@perawallet/walletconnect`, `@walletconnect/types` → `@perawallet/walletconnect/types`).
5. First npm publish succeeds via OIDC with provenance visible on npmjs.com.
