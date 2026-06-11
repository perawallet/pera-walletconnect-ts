# WalletConnect v1 Modernization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the forked WalletConnect v1.8.0 monorepo into a single modern package `@perawallet/walletconnect@1.0.0` with runtime deps of exactly `@noble/ciphers` + `@noble/hashes`, byte-identical WC v1 wire behavior (proven by interop tests against the original packages), pera-rn tooling conventions, and OIDC trusted publishing.

**Architecture:** One pnpm-workspace package at `packages/walletconnect`. Old code is ported module-by-module from the existing 7 wallet-side packages (which stay in place as the copy source until the final cleanup task). External ReOwn micro-deps are vendored as internal modules; crypto is rebuilt on @noble primitives; `ws` is dropped in favor of `globalThis.WebSocket` (Node ≥ 22, browsers, RN all provide it natively).

**Tech Stack:** TypeScript 5.9 strict, vite + vite-plugin-dts (ESM+CJS dual), vitest + @vitest/coverage-v8, oxlint + oxfmt, pnpm 10.28.1, GitHub Actions (pinned SHAs), npm OIDC trusted publishing with provenance.

**Spec:** `docs/superpowers/specs/2026-06-11-walletconnect-v1-modernization-design.md`

**Spec deviation (improvement):** the spec listed `ws@^8` as an optional peer dependency. Node ≥ 22 ships a native global `WebSocket` (undici), as do browsers and React Native — so no `ws` runtime/peer dependency is needed at all. `ws` remains a devDependency only (it provides `WebSocketServer` for the mock bridge test utility). `engines.node >= 22` is set accordingly.

**Public API note:** consumers import only the `WalletConnect` class (default export) and types. The old `@walletconnect/utils` grab-bag is NOT re-exported publicly; vendored helpers are internal modules. One additive API improvement: `IWalletConnectOptions` gains `storage?: ISessionStorage` so RN consumers can inject a storage adapter (previously only reachable via the internal `IConnectorOpts.sessionStorage`).

---

## Final file map

```
packages/walletconnect/
  package.json, tsconfig.json, tsconfig.build.json, vite.config.ts, vitest.config.ts
  src/
    index.ts                 default export WalletConnect + type re-exports
    types/index.ts           ← copy of packages/helpers/types/index.d.ts (+ storage option)
    utils/encoding.ts        hex/utf8/bytes + ArrayBuffer converters (replaces @walletconnect/encoding, bn.js)
    utils/id.ts              payloadId, uuid (replaces @walletconnect/jsonrpc-utils, Math.random uuid)
    utils/json.ts            safeJsonParse/safeJsonStringify (replaces @walletconnect/safe-json)
    utils/rpc.ts             formatRpcError (from utils/payload.ts; promisify dropped — unused)
    utils/uri.ts             query-string helpers (URLSearchParams), parseWalletConnectUri, isWalletConnectSession
    utils/validators.ts      isJsonRpc*, isSilentPayload, isReservedEvent, isEmpty*, isHexString
    utils/constants.ts       reservedEvents, signingMethods, stateMethods, infuraNetworks
    utils/ethereum.ts        toChecksumAddress (@noble keccak), isValidAddress, parsePersonalSign, parseTransactionData
    browser/getters.ts       window getters (replaces @walletconnect/window-getters)
    browser/metadata.ts      getClientMeta (replaces @walletconnect/window-metadata)
    browser/env.ts           detectEnv/isMobile/etc. (replaces detect-browser)
    browser/local.ts         setLocal/getLocal/removeLocal
    browser/mobile.ts        mobileLinkChoiceKey, formatIOSMobile, saveMobileLinkInfo (registry.ts dropped — dead ReOwn endpoint, consumers deleted)
    crypto/random.ts         randomBytes via crypto.getRandomValues
    crypto/primitives.ts     aesCbcEncrypt/Decrypt, hmacSha256Sign (@noble)
    crypto/index.ts          generateKey, encrypt, decrypt, verifyHmac (ICryptoLib)
    transport/network.ts     NetworkMonitor
    transport/socket.ts      SocketTransport
    core/errors.ts, core/events.ts, core/storage.ts, core/url.ts, core/connector.ts
    client/index.ts          WalletConnect class (+ getRandomValues guard)
  test/
    mock-bridge.ts           in-memory WC v1 bridge (ws server, devDep)
    *.test.ts                unit tests per module
    interop/*.test.ts        golden interop vs @walletconnect/client@1.8.0 oracle
    consumer/                pera-connect surface compile check
.github/workflows/           pre-merge.yml, codeql.yml, scorecard.yml, sbom.yml, release.yml
pnpm-workspace.yaml, .tool-versions, package.json (root), RELEASING.md, NOTICE
```

Old packages under `packages/clients/*` and `packages/helpers/*` remain in the tree as the copy source until Task 16 deletes them. The workspace glob includes only `packages/walletconnect`, so they are inert.

---

### Task 1: Delete dead packages and lerna plumbing

**Files:**
- Delete: `packages/providers/`, `packages/sdk/`, `packages/helpers/qrcode-modal/`, `packages/helpers/react-native-dapp/`, `packages/helpers/signer-connection/`, `packages/helpers/http-connection/`, `example/`, `scripts/`, `lerna.json`, `package-lock.json`

- [ ] **Step 1: Remove directories and files**

```bash
git rm -r packages/providers packages/sdk \
  packages/helpers/qrcode-modal packages/helpers/react-native-dapp \
  packages/helpers/signer-connection packages/helpers/http-connection \
  example scripts lerna.json package-lock.json
rm -rf node_modules packages/*/*/node_modules
```

- [ ] **Step 2: Remove legacy lint config files if present**

```bash
git rm -f .eslintrc .eslintrc.json .eslintignore .prettierrc 2>/dev/null || true
ls -la  # confirm what config dotfiles remain; remove any eslint/prettier leftovers
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: remove dapp/ethereum packages, example app, and lerna plumbing"
```

---

### Task 2: Root pnpm workspace + toolchain pins

**Files:**
- Create: `pnpm-workspace.yaml`, `.tool-versions`
- Modify: `package.json` (root, full replacement), `.gitignore`

- [ ] **Step 1: Write `.tool-versions`**

```
nodejs 22
```

- [ ] **Step 2: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - packages/walletconnect

# Supply-chain hardening: dependencies must be published for at least 7 days
minimumReleaseAge: 10080
```

- [ ] **Step 3: Replace root `package.json`**

```json
{
  "name": "pera-walletconnect-monorepo",
  "private": true,
  "description": "Pera-maintained modernization of the WalletConnect v1 client",
  "license": "Apache-2.0",
  "packageManager": "pnpm@10.28.1",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -C packages/walletconnect build",
    "test": "pnpm -C packages/walletconnect test",
    "test:coverage": "pnpm -C packages/walletconnect test:coverage",
    "lint": "pnpm -C packages/walletconnect lint",
    "format": "pnpm -C packages/walletconnect format",
    "format:check": "pnpm -C packages/walletconnect format:check",
    "typecheck": "pnpm -C packages/walletconnect typecheck"
  }
}
```

- [ ] **Step 4: Update `.gitignore`** — ensure it contains:

```
node_modules/
dist/
coverage/
*.tgz
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "chore: adopt pnpm workspace with node 22 and 7-day dependency cooldown"
```

---

### Task 3: Package skeleton (`packages/walletconnect`)

**Files:**
- Create: `packages/walletconnect/package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/index.ts` (temporary stub, replaced in Task 13)

- [ ] **Step 1: Write `packages/walletconnect/package.json`**

Check latest versions satisfying the 7-day cooldown with `pnpm view <pkg> versions --json | tail`; the majors below are required, patch levels may float forward.

```json
{
  "name": "@perawallet/walletconnect",
  "version": "1.0.0",
  "description": "Modern, security-forward WalletConnect v1 client maintained by Pera Wallet",
  "license": "Apache-2.0",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/perawallet/pera-walletconnect-ts.git"
  },
  "type": "module",
  "sideEffects": false,
  "engines": { "node": ">=22" },
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./types": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/types/index.js",
      "require": "./dist/types/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "files": ["dist", "NOTICE"],
  "scripts": {
    "build": "vite build",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint",
    "format": "oxfmt",
    "format:check": "oxfmt --check",
    "prepack": "pnpm build"
  },
  "dependencies": {
    "@noble/ciphers": "^2.0.0",
    "@noble/hashes": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/ws": "^8.5.0",
    "@vitest/coverage-v8": "^4.0.0",
    "@walletconnect/client": "1.8.0",
    "@walletconnect/crypto": "1.0.3",
    "oxlint": "^1.0.0",
    "oxfmt": "^0.45.0",
    "publint": "^0.3.0",
    "typescript": "~5.9.0",
    "vite": "^7.0.0",
    "vite-plugin-dts": "^4.0.0",
    "vitest": "^4.0.0",
    "ws": "^8.20.0"
  }
}
```

Note: `@walletconnect/client` + `@walletconnect/crypto` are the interop **oracle** (devDeps only, exact-pinned). `ws` is devDep only (mock bridge server).

- [ ] **Step 2: Write `packages/walletconnect/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
}
```

`skipLibCheck` is required because the legacy oracle devDeps ship 2020-era type defs.

- [ ] **Step 3: Write `packages/walletconnect/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [dts({ include: ["src"] })],
  build: {
    target: "es2022",
    lib: {
      entry: {
        index: "src/index.ts",
        "types/index": "src/types/index.ts",
      },
      formats: ["es", "cjs"],
      fileName: (format, entryName) => `${entryName}.${format === "es" ? "js" : "cjs"}`,
    },
    rollupOptions: {
      external: [/^@noble\//],
    },
  },
});
```

- [ ] **Step 4: Write `packages/walletconnect/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
```

- [ ] **Step 5: Write temporary `src/index.ts` stub** (replaced in Task 13)

```ts
export {};
```

- [ ] **Step 6: Install and verify**

```bash
pnpm install
pnpm -C packages/walletconnect typecheck
```
Expected: install succeeds, lockfile created, typecheck passes.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: scaffold @perawallet/walletconnect package with vite/vitest/oxlint toolchain"
```

---

### Task 4: Types module

**Files:**
- Create: `packages/walletconnect/src/types/index.ts` (from `packages/helpers/types/index.d.ts`)

- [ ] **Step 1: Copy the types file**

```bash
cp packages/helpers/types/index.d.ts packages/walletconnect/src/types/index.ts
```

The file is plain `export interface` declarations — no `declare module` wrapper — so it compiles as a regular module.

- [ ] **Step 2: Add the `storage` option to `IWalletConnectOptions`**

Find the `IWalletConnectOptions` interface in `src/types/index.ts` and add one field:

```ts
export interface IWalletConnectOptions {
  bridge?: string;
  uri?: string;
  storageId?: string;
  signingMethods?: string[];
  session?: IWalletConnectSession;
  storage?: ISessionStorage;   // ← add this line (additive; enables RN storage injection)
  clientMeta?: IClientMeta;
  qrcodeModal?: IQRCodeModal;
  qrcodeModalOptions?: IQRCodeModalOptions;
}
```

(Match the actual field list in the copied file — only **add** `storage?: ISessionStorage`, change nothing else.)

- [ ] **Step 3: Typecheck and commit**

```bash
pnpm -C packages/walletconnect typecheck
git add -A && git commit -m "feat: port WC v1 type definitions with injectable storage option"
```

---

### Task 5: Encoding utils (replaces @walletconnect/encoding + bn.js)

**Files:**
- Create: `packages/walletconnect/src/utils/encoding.ts`
- Test: `packages/walletconnect/test/encoding.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import * as enc from "../src/utils/encoding";

const STR = "wallet";
const STR_HEX = "0x77616c6c6574";
const STR_BYTES = new Uint8Array([0x77, 0x61, 0x6c, 0x6c, 0x65, 0x74]);

describe("hex helpers", () => {
  it("addHexPrefix / removeHexPrefix", () => {
    expect(enc.addHexPrefix("ff")).toBe("0xff");
    expect(enc.addHexPrefix("0xff")).toBe("0xff");
    expect(enc.removeHexPrefix("0xff")).toBe("ff");
    expect(enc.removeHexPrefix("ff")).toBe("ff");
  });
  it("sanitizeHex pads odd-length and keeps prefix", () => {
    expect(enc.sanitizeHex("0xfff")).toBe("0x0fff");
    expect(enc.sanitizeHex("fff")).toBe("0x0fff");
    expect(enc.sanitizeHex("")).toBe("");
  });
  it("removeHexLeadingZeros", () => {
    expect(enc.removeHexLeadingZeros("0x0010")).toBe("0x10");
    expect(enc.removeHexLeadingZeros("0x0000")).toBe("0x0");
  });
  it("isHexString", () => {
    expect(enc.isHexString(STR_HEX)).toBe(true);
    expect(enc.isHexString("wallet")).toBe(false);
    expect(enc.isHexString(123)).toBe(false);
  });
});

describe("byte conversions", () => {
  it("hexToArray / arrayToHex round-trip", () => {
    expect(enc.hexToArray(STR_HEX)).toEqual(STR_BYTES);
    expect(enc.arrayToHex(STR_BYTES)).toBe("77616c6c6574");
    expect(enc.arrayToHex(STR_BYTES, true)).toBe(STR_HEX);
  });
  it("utf8ToArray / arrayToUtf8 round-trip", () => {
    expect(enc.utf8ToArray(STR)).toEqual(STR_BYTES);
    expect(enc.arrayToUtf8(STR_BYTES)).toBe(STR);
  });
  it("concatArrays", () => {
    expect(enc.concatArrays(new Uint8Array([1, 2]), new Uint8Array([3]))).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });
});

describe("ArrayBuffer converters (ICryptoLib surface)", () => {
  it("convertHexToArrayBuffer / convertArrayBufferToHex", () => {
    const ab = enc.convertHexToArrayBuffer(STR_HEX);
    expect(new Uint8Array(ab)).toEqual(STR_BYTES);
    expect(enc.convertArrayBufferToHex(ab)).toBe(STR_HEX);
    expect(enc.convertArrayBufferToHex(ab, true)).toBe("77616c6c6574");
  });
  it("convertUtf8ToArrayBuffer / convertArrayBufferToUtf8", () => {
    const ab = enc.convertUtf8ToArrayBuffer(STR);
    expect(enc.convertArrayBufferToUtf8(ab)).toBe(STR);
  });
});

describe("number conversions (BigInt replaces bn.js)", () => {
  it("convertNumberToHex", () => {
    expect(enc.convertNumberToHex(16)).toBe("0x10");
    expect(enc.convertNumberToHex(16, true)).toBe("10");
    expect(enc.convertNumberToHex("16")).toBe("0x10");
    expect(enc.convertNumberToHex(255)).toBe("0xff");
  });
  it("convertHexToNumber / convertUtf8ToNumber", () => {
    expect(enc.convertHexToNumber("0x10")).toBe(16);
    expect(enc.convertUtf8ToNumber("16")).toBe(16);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/encoding.test.ts`
Expected: FAIL — module `../src/utils/encoding` not found.

- [ ] **Step 3: Write `src/utils/encoding.ts`**

```ts
// Vendored replacement for @walletconnect/encoding (Apache-2.0) and the
// bn.js-based converters from @walletconnect/utils. Uint8Array-native; the
// ArrayBuffer variants exist because ICryptoLib's frozen signatures use them.

// -- hex string helpers ----------------------------------------------------

export function removeHexPrefix(hex: string): string {
  return hex.replace(/^0x/i, "");
}

export function addHexPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex : `0x${hex}`;
}

export function sanitizeHex(hex: string): string {
  hex = removeHexPrefix(hex);
  if (!hex) {
    return "";
  }
  if (hex.length % 2 !== 0) {
    hex = `0${hex}`;
  }
  return addHexPrefix(hex);
}

export function removeHexLeadingZeros(hex: string): string {
  const stripped = removeHexPrefix(hex).replace(/^0+(?=.)/, "");
  return addHexPrefix(stripped);
}

export function isHexString(value: unknown, length?: number): boolean {
  if (typeof value !== "string" || !/^0x[0-9A-Fa-f]*$/.test(value)) {
    return false;
  }
  if (length && value.length !== 2 + 2 * length) {
    return false;
  }
  return true;
}

// -- bytes ------------------------------------------------------------------

const HEX_CHARS = "0123456789abcdef";

export function hexToArray(hex: string): Uint8Array {
  const clean = removeHexPrefix(sanitizeHex(hex));
  const result = new Uint8Array(clean.length / 2);
  for (let i = 0; i < result.length; i++) {
    result[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return result;
}

export function arrayToHex(arr: Uint8Array, prefixed = false): string {
  let hex = "";
  for (let i = 0; i < arr.length; i++) {
    hex += HEX_CHARS[arr[i]! >> 4]! + HEX_CHARS[arr[i]! & 0x0f]!;
  }
  return prefixed ? addHexPrefix(hex) : hex;
}

export function utf8ToArray(utf8: string): Uint8Array {
  return new TextEncoder().encode(utf8);
}

export function arrayToUtf8(arr: Uint8Array): string {
  return new TextDecoder().decode(arr);
}

export function concatArrays(...args: Uint8Array[]): Uint8Array {
  const length = args.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const arr of args) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// -- ArrayBuffer variants (ICryptoLib signatures) ----------------------------

export function convertHexToArrayBuffer(hex: string): ArrayBuffer {
  return hexToArray(hex).buffer as ArrayBuffer;
}

export function convertArrayBufferToHex(ab: ArrayBuffer, noPrefix?: boolean): string {
  return arrayToHex(new Uint8Array(ab), !noPrefix);
}

export function convertUtf8ToArrayBuffer(utf8: string): ArrayBuffer {
  return utf8ToArray(utf8).buffer as ArrayBuffer;
}

export function convertArrayBufferToUtf8(ab: ArrayBuffer): string {
  return arrayToUtf8(new Uint8Array(ab));
}

// -- numbers (BigInt replaces bn.js) ------------------------------------------

export function convertNumberToHex(num: number | string, noPrefix?: boolean): string {
  const value = typeof num === "string" ? BigInt(num) : BigInt(Math.trunc(num));
  const hex = removeHexPrefix(sanitizeHex(value.toString(16)));
  return noPrefix ? hex : addHexPrefix(hex);
}

export function convertHexToNumber(hex: string): number {
  return Number(BigInt(addHexPrefix(removeHexPrefix(hex) || "0")));
}

export function convertUtf8ToNumber(utf8: string): number {
  return Number(BigInt(utf8));
}

export function convertUtf8ToHex(utf8: string, noPrefix?: boolean): string {
  const hex = arrayToHex(utf8ToArray(utf8));
  return noPrefix ? hex : addHexPrefix(hex);
}

export function convertHexToUtf8(hex: string): string {
  return arrayToUtf8(hexToArray(hex));
}
```

Behavior notes (deliberate, document in commit message): `arrayToHex` default is unprefixed (matches vendored `encoding.arrayToHex`) while `convertArrayBufferToHex` default is prefixed (matches old `@walletconnect/utils` signature with `noPrefix?` flag) — both call sites in ported code rely on these exact defaults. `removeHexLeadingZeros` strips all leading zeros keeping one digit (EIP-1474 quantity formatting; only used for tx-data convenience parsing, not protocol bytes).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/walletconnect exec vitest run test/encoding.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add Uint8Array-native encoding utils replacing @walletconnect/encoding and bn.js"
```

---

### Task 6: Crypto module (@noble-based, golden-vector verified)

**Files:**
- Create: `src/crypto/random.ts`, `src/crypto/primitives.ts`, `src/crypto/index.ts`
- Test: `test/crypto.test.ts`

The golden vector below is copied verbatim from `packages/helpers/iso-crypto/test/index.spec.ts` — it was committed by upstream WalletConnect and encodes the exact v1 wire format. Passing it proves byte-compatibility.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateKey, encrypt, decrypt, verifyHmac } from "../src/crypto";
import { randomBytes } from "../src/crypto/random";
import { convertHexToArrayBuffer, hexToArray } from "../src/utils/encoding";
import type { IJsonRpcRequest } from "../src/types";

// Upstream-committed golden vector (packages/helpers/iso-crypto/test/index.spec.ts)
const TEST_JSON_RPC_REQUEST: IJsonRpcRequest = {
  id: 1,
  jsonrpc: "2.0",
  method: "wc_test",
  params: [],
};
const TEST_KEY = "2254c5145902fe280fb035e98bea896e024b78ccab33a62a38f538c860d60339";
const TEST_IV = "81413061def750d1a8f857d98d66584d";
const TEST_ENCRYPTION_PAYLOAD = {
  data:
    "170ac2b0c8ba61ac268455c42eb72c452e23888c6b357bcfc1b8c4c12770690c714e2171ceee0fa4aa639bcbfb9c6b111cbad0f73759c782253a3b4c0da1c43e",
  hmac: "f779131fb8976435eb6984c23f597ffdf2f2a7122543d27907774c0f92142d33",
  iv: "81413061def750d1a8f857d98d66584d",
};

describe("crypto golden vectors (WC v1 wire format)", () => {
  it("encrypt reproduces the upstream payload byte-for-byte", async () => {
    const result = await encrypt(
      TEST_JSON_RPC_REQUEST,
      convertHexToArrayBuffer(TEST_KEY),
      convertHexToArrayBuffer(TEST_IV),
    );
    expect(result).toEqual(TEST_ENCRYPTION_PAYLOAD);
  });

  it("decrypt consumes the upstream payload", async () => {
    const result = await decrypt(TEST_ENCRYPTION_PAYLOAD, convertHexToArrayBuffer(TEST_KEY));
    expect(result).toEqual(TEST_JSON_RPC_REQUEST);
  });

  it("verifyHmac accepts valid and rejects tampered payloads", async () => {
    const key = hexToArray(TEST_KEY);
    expect(await verifyHmac(TEST_ENCRYPTION_PAYLOAD, key)).toBe(true);
    const tampered = { ...TEST_ENCRYPTION_PAYLOAD, hmac: "00" + TEST_ENCRYPTION_PAYLOAD.hmac.slice(2) };
    expect(await verifyHmac(tampered, key)).toBe(false);
  });

  it("decrypt returns null for tampered ciphertext", async () => {
    const tampered = { ...TEST_ENCRYPTION_PAYLOAD, data: "00" + TEST_ENCRYPTION_PAYLOAD.data.slice(2) };
    expect(await decrypt(tampered, convertHexToArrayBuffer(TEST_KEY))).toBeNull();
  });
});

describe("key generation", () => {
  it("generateKey returns 32 random bytes by default", async () => {
    const a = new Uint8Array(await generateKey());
    const b = new Uint8Array(await generateKey());
    expect(a.length).toBe(32);
    expect(b.length).toBe(32);
    expect(a).not.toEqual(b);
  });

  it("randomBytes throws a clear error without crypto.getRandomValues", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => randomBytes(32)).toThrowError(/getRandomValues/);
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});

describe("round-trip", () => {
  it("encrypt → decrypt round-trips with a fresh key", async () => {
    const key = await generateKey();
    const payload = await encrypt(TEST_JSON_RPC_REQUEST, key);
    expect(await decrypt(payload, key)).toEqual(TEST_JSON_RPC_REQUEST);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/crypto.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `src/crypto/random.ts`**

```ts
export function randomBytes(length: number): Uint8Array {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error(
      "crypto.getRandomValues is not available. In React Native, install a polyfill " +
        "such as react-native-quick-crypto or react-native-get-random-values before " +
        "importing @perawallet/walletconnect.",
    );
  }
  return cryptoObj.getRandomValues(new Uint8Array(length));
}
```

- [ ] **Step 4: Write `src/crypto/primitives.ts`**

```ts
import { cbc } from "@noble/ciphers/aes.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

// WC v1 scheme: AES-256-CBC with PKCS#7 padding (noble's cbc default),
// authenticated by HMAC-SHA256 over ciphertext||iv.

export function aesCbcEncrypt(iv: Uint8Array, key: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, iv).encrypt(data);
}

export function aesCbcDecrypt(iv: Uint8Array, key: Uint8Array, data: Uint8Array): Uint8Array {
  return cbc(key, iv).decrypt(data);
}

export function hmacSha256Sign(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}
```

If the installed @noble major exposes different subpaths (e.g. no `.js` suffix), adjust the import specifiers to match — verify with `pnpm -C packages/walletconnect exec node -e "import('@noble/ciphers/aes.js').then(m => console.log(!!m.cbc))"`.

- [ ] **Step 5: Write `src/crypto/index.ts`**

```ts
import type {
  IEncryptionPayload,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
} from "../types";
import {
  arrayToHex,
  arrayToUtf8,
  concatArrays,
  hexToArray,
  utf8ToArray,
} from "../utils/encoding";
import { aesCbcDecrypt, aesCbcEncrypt, hmacSha256Sign } from "./primitives";
import { randomBytes } from "./random";

type JsonRpcPayload = IJsonRpcRequest | IJsonRpcResponseSuccess | IJsonRpcResponseError;

export async function generateKey(length?: number): Promise<ArrayBuffer> {
  return randomBytes((length || 256) / 8).buffer as ArrayBuffer;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

export async function verifyHmac(payload: IEncryptionPayload, key: Uint8Array): Promise<boolean> {
  const cipherText = hexToArray(payload.data);
  const iv = hexToArray(payload.iv);
  const expected = hexToArray(payload.hmac);
  const actual = hmacSha256Sign(key, concatArrays(cipherText, iv));
  return constantTimeEqual(expected, actual);
}

export async function encrypt(
  data: JsonRpcPayload,
  key: ArrayBuffer,
  providedIv?: ArrayBuffer,
): Promise<IEncryptionPayload> {
  const keyBytes = new Uint8Array(key);
  const iv = providedIv ? new Uint8Array(providedIv) : randomBytes(16);
  const content = utf8ToArray(JSON.stringify(data));
  const cipherText = aesCbcEncrypt(iv, keyBytes, content);
  const hmac = hmacSha256Sign(keyBytes, concatArrays(cipherText, iv));
  return {
    data: arrayToHex(cipherText),
    hmac: arrayToHex(hmac),
    iv: arrayToHex(iv),
  };
}

export async function decrypt(
  payload: IEncryptionPayload,
  key: ArrayBuffer,
): Promise<JsonRpcPayload | null> {
  const keyBytes = new Uint8Array(key);
  if (!keyBytes.length) {
    throw new Error("Missing key: required for decryption");
  }
  if (!(await verifyHmac(payload, keyBytes))) {
    return null;
  }
  try {
    const buffer = aesCbcDecrypt(hexToArray(payload.iv), keyBytes, hexToArray(payload.data));
    return JSON.parse(arrayToUtf8(buffer));
  } catch {
    return null;
  }
}
```

**Careful:** `aesCbcDecrypt` takes `(iv, key, data)` in that order — the golden decrypt test catches any argument-order mistake here.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/walletconnect exec vitest run test/crypto.test.ts`
Expected: PASS — including the byte-exact golden vector tests.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: rebuild WC v1 crypto on @noble/ciphers and @noble/hashes, golden-vector verified"
```

---

### Task 7: Small utils (json, id, rpc, validators, constants)

**Files:**
- Create: `src/utils/json.ts`, `src/utils/id.ts`, `src/utils/rpc.ts`, `src/utils/constants.ts`, `src/utils/validators.ts`
- Test: `test/utils.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { safeJsonParse, safeJsonStringify } from "../src/utils/json";
import { payloadId, uuid } from "../src/utils/id";
import { formatRpcError } from "../src/utils/rpc";
import {
  isJsonRpcRequest,
  isJsonRpcResponseSuccess,
  isJsonRpcResponseError,
  isInternalEvent,
  isReservedEvent,
  isSilentPayload,
} from "../src/utils/validators";

describe("safe json", () => {
  it("parses valid JSON and passes through invalid", () => {
    expect(safeJsonParse('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonParse("not-json")).toBe("not-json");
  });
  it("stringifies non-strings and passes through strings", () => {
    expect(safeJsonStringify({ a: 1 })).toBe('{"a":1}');
    expect(safeJsonStringify("already")).toBe("already");
  });
});

describe("ids", () => {
  it("payloadId is a unique positive integer", () => {
    const a = payloadId();
    const b = payloadId();
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
  it("uuid is RFC4122 v4 shaped", () => {
    expect(uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(uuid()).not.toBe(uuid());
  });
});

describe("formatRpcError", () => {
  it("maps known messages to codes and defaults to -32000", () => {
    expect(formatRpcError({ message: "Method not found" }).code).toBe(-32601);
    expect(formatRpcError({}).message).toBe("Failed or Rejected Request");
    expect(formatRpcError({}).code).toBe(-32000);
  });
});

describe("payload validators", () => {
  it("classifies payload shapes", () => {
    expect(isJsonRpcRequest({ method: "x" })).toBe(true);
    expect(isJsonRpcResponseSuccess({ result: 1 })).toBe(true);
    expect(isJsonRpcResponseError({ error: { message: "x" } })).toBe(true);
    expect(isInternalEvent({ event: "connect" })).toBe(true);
  });
  it("isReservedEvent covers wc_ prefix and reserved list", () => {
    expect(isReservedEvent("connect")).toBe(true);
    expect(isReservedEvent("wc_sessionRequest")).toBe(true);
    expect(isReservedEvent("algo_signTxn")).toBe(false);
  });
  it("isSilentPayload: wc_ methods silent, signing methods loud, others silent", () => {
    expect(isSilentPayload({ id: 1, jsonrpc: "2.0", method: "wc_sessionUpdate", params: [] })).toBe(true);
    expect(isSilentPayload({ id: 1, jsonrpc: "2.0", method: "eth_sendTransaction", params: [] })).toBe(false);
    expect(isSilentPayload({ id: 1, jsonrpc: "2.0", method: "eth_getBalance", params: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/utils.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementations**

`src/utils/json.ts` (vendored from @walletconnect/safe-json, MIT):

```ts
export function safeJsonParse(value: string): any {
  if (typeof value !== "string") {
    throw new Error(`Cannot safe json parse value of type ${typeof value}`);
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function safeJsonStringify(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
```

`src/utils/id.ts` (payloadId vendored from @walletconnect/jsonrpc-utils, MIT; uuid upgraded from Math.random to crypto randomness — output format unchanged):

```ts
import { randomBytes } from "../crypto/random";
import { arrayToHex } from "./encoding";

export function payloadId(): number {
  const date = Date.now() * 1000;
  const extra = Math.floor(Math.random() * 1000);
  return date + extra;
}

export function uuid(): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = arrayToHex(bytes);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

`src/utils/rpc.ts` — copy `formatRpcError` verbatim from `packages/helpers/utils/src/payload.ts` (lines 30–65), changing only the type import to `import type { IJsonRpcErrorMessage } from "../types";`. Do NOT port `promisify` (its only consumer, web3-provider, was deleted).

`src/utils/constants.ts` — copy `packages/helpers/utils/src/constants.ts` verbatim (no changes; keep `signingMethods`/`infuraNetworks` for full v1 capability).

`src/utils/validators.ts` — copy `packages/helpers/utils/src/validators.ts`, changing the imports to:

```ts
import type {
  IInternalEvent,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
  IJsonRpcSubscription,
} from "../types";
import { isHexString } from "./encoding";
import { reservedEvents, signingMethods } from "./constants";
```

and: re-export `isHexString` (`export { isHexString };`), keep `isEmptyString`, `isEmptyArray`, `isJsonRpcSubscription`, `isJsonRpcRequest`, `isJsonRpcResponseSuccess`, `isJsonRpcResponseError`, `isInternalEvent`, `isReservedEvent`, `isSilentPayload` with bodies unchanged, and DROP `isBuffer`/`isTypedArray`/`isArrayBuffer`/`getType`/`getEncoding` (Buffer-era helpers, no surviving consumers).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/walletconnect exec vitest run test/utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: port json/id/rpc/validator utils, vendor safe-json and payloadId"
```

---

### Task 8: URI utils (URLSearchParams replaces query-string)

**Files:**
- Create: `src/utils/uri.ts`
- Test: `test/uri.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  getQueryString,
  appendToQueryString,
  parseQueryString,
  formatQueryString,
  parseWalletConnectUri,
  isWalletConnectSession,
} from "../src/utils/uri";

describe("query string helpers", () => {
  it("getQueryString extracts from ? onward", () => {
    expect(getQueryString("https://x.y/path?a=1&b=2")).toBe("?a=1&b=2");
    expect(getQueryString("https://x.y/path")).toBe("");
  });
  it("parse/format round-trip", () => {
    expect(parseQueryString("?a=1&b=two")).toEqual({ a: "1", b: "two" });
    expect(formatQueryString({ a: "1", b: "two" })).toBe("a=1&b=two");
  });
  it("appendToQueryString merges params", () => {
    expect(parseQueryString(appendToQueryString("?a=1", { b: "2" }))).toEqual({ a: "1", b: "2" });
  });
});

describe("parseWalletConnectUri", () => {
  it("parses the WC v1 URI format", () => {
    const uri =
      "wc:8a5e5bdc-a0e4-47...TopicId@1?bridge=https%3A%2F%2Fbridge.example.org&key=41791102999c339c844880b23950704cc43aa840f3739e365323cda4dfa89e7a";
    const result = parseWalletConnectUri(uri);
    expect(result.protocol).toBe("wc");
    expect(result.handshakeTopic).toBe("8a5e5bdc-a0e4-47...TopicId");
    expect(result.version).toBe(1);
    expect(result.bridge).toBe("https://bridge.example.org");
    expect(result.key).toBe("41791102999c339c844880b23950704cc43aa840f3739e365323cda4dfa89e7a");
  });
});

describe("isWalletConnectSession", () => {
  it("detects session objects by bridge field", () => {
    expect(isWalletConnectSession({ bridge: "https://b" })).toBe(true);
    expect(isWalletConnectSession({})).toBe(false);
  });
});
```

**Compatibility note:** `query-string@6` decoded percent-encoded values, so `result.bridge` from `parseQueryString` was already decoded; `Connector._parseUri` then calls `decodeURIComponent(result.bridge)` again (double-decode is harmless for URLs without literal `%` sequences). `URLSearchParams` also decodes — behavior preserved.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/uri.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/utils/uri.ts`**

Copy `parseWalletConnectUri` and `isWalletConnectSession` bodies verbatim from `packages/helpers/utils/src/session.ts` (types now from `../types`), replace `str.substr(pathEnd)` with `str.substring(pathEnd)`, and implement the query helpers with `URLSearchParams`:

```ts
export function getQueryString(url: string): string {
  const pathEnd = url.indexOf("?");
  return pathEnd >= 0 ? url.substring(pathEnd) : "";
}

export function parseQueryString(queryString: string): Record<string, string> {
  const result: Record<string, string> = {};
  new URLSearchParams(
    queryString.startsWith("?") ? queryString.substring(1) : queryString,
  ).forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function formatQueryString(queryParams: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(queryParams)) {
    params.append(key, String(value));
  }
  return params.toString();
}

export function appendToQueryString(
  queryString: string,
  newQueryParams: Record<string, unknown>,
): string {
  return formatQueryString({ ...parseQueryString(queryString), ...newQueryParams });
}
```

- [ ] **Step 4: Run test, expect PASS, commit**

```bash
pnpm -C packages/walletconnect exec vitest run test/uri.test.ts
git add -A && git commit -m "feat: port URI/session utils onto URLSearchParams"
```

---

### Task 9: Ethereum utils (@noble keccak replaces js-sha3)

**Files:**
- Create: `src/utils/ethereum.ts`
- Test: `test/ethereum.test.ts`

- [ ] **Step 1: Write the failing test** (EIP-55 canonical vectors + upstream's test address)

```ts
import { describe, it, expect } from "vitest";
import {
  toChecksumAddress,
  isValidAddress,
  parsePersonalSign,
  parseTransactionData,
} from "../src/utils/ethereum";

// Canonical EIP-55 test vectors
const EIP55_VECTORS = [
  "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
  "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
  "0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB",
  "0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb",
  "0x9b7b2B4f7a391b6F14A81221AE0920A9735B67Fb", // upstream test address
];

describe("toChecksumAddress", () => {
  it("reproduces EIP-55 checksums", () => {
    for (const addr of EIP55_VECTORS) {
      expect(toChecksumAddress(addr.toLowerCase())).toBe(addr);
    }
  });
});

describe("isValidAddress", () => {
  it("accepts checksummed, all-lower, and all-upper addresses", () => {
    expect(isValidAddress(EIP55_VECTORS[0])).toBe(true);
    expect(isValidAddress(EIP55_VECTORS[0]!.toLowerCase())).toBe(true);
    expect(isValidAddress(undefined)).toBe(false);
    expect(isValidAddress("0x123")).toBe(false);
    expect(isValidAddress("5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(false);
  });
});

describe("parsePersonalSign", () => {
  it("hex-encodes a plain-text first param", () => {
    expect(parsePersonalSign(["hello", "0xabc"])).toEqual(["0x68656c6c6f", "0xabc"]);
    expect(parsePersonalSign(["0xdeadbeef", "0xabc"])).toEqual(["0xdeadbeef", "0xabc"]);
  });
});

describe("parseTransactionData", () => {
  const FROM = EIP55_VECTORS[0]!.toLowerCase();
  it("formats numeric fields as minimal hex quantities", () => {
    const tx = parseTransactionData({ from: FROM, value: 16, nonce: "0x0010" });
    expect(tx.value).toBe("0x10");
    expect(tx.nonce).toBe("0x10");
    expect(tx.data).toBe("0x");
  });
  it("prunes empty optional fields", () => {
    const tx = parseTransactionData({ from: FROM });
    expect("gasPrice" in tx).toBe(false);
    expect("value" in tx).toBe(false);
  });
  it("throws without a valid from", () => {
    expect(() => parseTransactionData({ to: FROM })).toThrowError(/from/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/ethereum.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/utils/ethereum.ts`**

Copy `packages/helpers/utils/src/ethereum.ts` verbatim, with only these changes:

```ts
// old:
import { keccak_256 } from "js-sha3";
import { removeHexPrefix, addHexPrefix } from "@walletconnect/encoding";
import { ITxData } from "@walletconnect/types";
import { convertUtf8ToHex, convertNumberToHex, convertUtf8ToBuffer } from "./encoding";
import { sanitizeHex, removeHexLeadingZeros } from "./misc";
import { isEmptyArray, isHexString, isEmptyString } from "./validators";

// new:
import { keccak_256 } from "@noble/hashes/sha3.js";
import type { ITxData } from "../types";
import {
  addHexPrefix,
  arrayToHex,
  convertNumberToHex,
  convertUtf8ToHex,
  removeHexLeadingZeros,
  removeHexPrefix,
  sanitizeHex,
  utf8ToArray,
} from "./encoding";
import { isEmptyArray, isHexString, isEmptyString } from "./validators";
```

and in `toChecksumAddress`, replace the hash line:

```ts
// old: const hash = removeHexPrefix(keccak_256(convertUtf8ToBuffer(address)));
const hash = arrayToHex(keccak_256(utf8ToArray(address)));
```

Also add `!` non-null assertions where `noUncheckedIndexedAccess` requires (`hash[i]!`, `address[i]!`), and type `txDataRPC` indexing as `(txDataRPC as Record<string, unknown>)[key]` in the prune loop. Everything else byte-identical.

- [ ] **Step 4: Run test, expect PASS, commit**

```bash
pnpm -C packages/walletconnect exec vitest run test/ethereum.test.ts
git add -A && git commit -m "feat: port ethereum utils onto @noble keccak, EIP-55 vector tested"
```

---

### Task 10: Browser module (getters, metadata, env, local, mobile)

**Files:**
- Create: `src/browser/getters.ts`, `src/browser/metadata.ts`, `src/browser/env.ts`, `src/browser/local.ts`, `src/browser/mobile.ts`
- Test: `test/browser.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { getLocalStorage, getNavigator, getFromWindow } from "../src/browser/getters";
import { detectEnv, isAndroid, isIOS, isMobile, isBrowser, isNode } from "../src/browser/env";
import { setLocal, getLocal, removeLocal } from "../src/browser/local";
import { formatIOSMobile, saveMobileLinkInfo, mobileLinkChoiceKey } from "../src/browser/mobile";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

afterEach(() => vi.unstubAllGlobals());

describe("window getters in Node (no window)", () => {
  it("return undefined instead of throwing", () => {
    expect(getFromWindow("document")).toBeUndefined();
    expect(getNavigator()).toBeUndefined();
    expect(getLocalStorage()).toBeUndefined();
  });
});

describe("env detection", () => {
  it("detects node when no navigator exists", () => {
    expect(detectEnv()?.name).toBe("node");
    expect(isNode()).toBe(true);
    expect(isBrowser()).toBe(false);
  });
  it("detects react-native via navigator.product", () => {
    vi.stubGlobal("navigator", { product: "ReactNative" });
    expect(detectEnv()?.name).toBe("react-native");
  });
  it("classifies user agents", () => {
    expect(detectEnv(ANDROID_UA)?.os?.toLowerCase()).toContain("android");
    expect(detectEnv(IOS_UA)?.os?.toLowerCase()).toContain("ios");
    expect(detectEnv(DESKTOP_UA)?.os?.toLowerCase()).toContain("mac");
  });
  it("isAndroid / isIOS / isMobile follow the active navigator UA", () => {
    vi.stubGlobal("navigator", { userAgent: ANDROID_UA, maxTouchPoints: 5 });
    expect(isAndroid()).toBe(true);
    expect(isMobile()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: IOS_UA, maxTouchPoints: 5 });
    expect(isIOS()).toBe(true);
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA, maxTouchPoints: 0 });
    expect(isMobile()).toBe(false);
  });
});

describe("local storage helpers", () => {
  it("no-op without localStorage", () => {
    expect(() => setLocal("k", { a: 1 })).not.toThrow();
    expect(getLocal("k")).toBeNull();
    expect(() => removeLocal("k")).not.toThrow();
  });
  it("round-trip with a stubbed localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    setLocal("k", { a: 1 });
    expect(getLocal("k")).toEqual({ a: 1 });
    removeLocal("k");
    expect(getLocal("k")).toBeNull();
  });
});

describe("mobile linking", () => {
  it("formatIOSMobile builds universal and deep links", () => {
    const entry = (overrides: object) => ({
      name: "Pera", shortName: "Pera", color: "", logo: "",
      universalLink: "", deepLink: "", ...overrides,
    });
    expect(formatIOSMobile("wc:t@1?k=v", entry({ universalLink: "https://pera.app" })))
      .toBe(`https://pera.app/wc?uri=${encodeURIComponent("wc:t@1?k=v")}`);
    expect(formatIOSMobile("wc:t@1?k=v", entry({ deepLink: "pera:" })))
      .toBe(`pera://wc?uri=${encodeURIComponent("wc:t@1?k=v")}`);
  });
  it("saveMobileLinkInfo strips the query from href", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        setItem: (k: string, v: string) => void store.set(k, v),
        getItem: (k: string) => store.get(k) ?? null,
        removeItem: (k: string) => void store.delete(k),
      },
    });
    saveMobileLinkInfo({ name: "Pera", href: "pera://wc?uri=abc" });
    expect(JSON.parse(store.get(mobileLinkChoiceKey)!)).toEqual({ name: "Pera", href: "pera://wc" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/browser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/browser/getters.ts`** (vendored from @walletconnect/window-getters, MIT)

```ts
export function getFromWindow<T>(name: string): T | undefined {
  let res: T | undefined = undefined;
  if (typeof window !== "undefined" && typeof (window as any)[name] !== "undefined") {
    res = (window as any)[name];
  }
  return res;
}

export function getFromWindowOrThrow<T>(name: string): T {
  const res = getFromWindow<T>(name);
  if (!res) {
    throw new Error(`${name} is not defined in Window`);
  }
  return res;
}

export const getDocument = () => getFromWindow<Document>("document");
export const getDocumentOrThrow = () => getFromWindowOrThrow<Document>("document");
export const getNavigator = () => getFromWindow<Navigator>("navigator");
export const getNavigatorOrThrow = () => getFromWindowOrThrow<Navigator>("navigator");
export const getLocation = () => getFromWindow<Location>("location");
export const getLocationOrThrow = () => getFromWindowOrThrow<Location>("location");
export const getCrypto = () => getFromWindow<Crypto>("crypto");
export const getCryptoOrThrow = () => getFromWindowOrThrow<Crypto>("crypto");
export const getLocalStorage = () => getFromWindow<Storage>("localStorage");
export const getLocalStorageOrThrow = () => getFromWindowOrThrow<Storage>("localStorage");
```

- [ ] **Step 4: Write `src/browser/env.ts`** (replaces detect-browser with the minimal surface actually used: os classification + node/react-native detection)

```ts
import { getNavigator } from "./getters";

export interface IEnvInfo {
  name: string;
  version?: string;
  os?: string;
}

function detectOSFromUA(ua: string): string | undefined {
  if (/android/i.test(ua)) return "Android OS";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/windows/i.test(ua)) return "Windows";
  if (/mac os/i.test(ua)) return "Mac OS";
  if (/linux/i.test(ua)) return "Linux";
  return undefined;
}

function detectBrowserName(ua: string): string {
  if (/edg\//i.test(ua)) return "edge";
  if (/opr\/|opera/i.test(ua)) return "opera";
  if (/samsungbrowser/i.test(ua)) return "samsung";
  if (/firefox|fxios/i.test(ua)) return "firefox";
  if (/chrome|crios/i.test(ua)) return "chrome";
  if (/safari/i.test(ua)) return "safari";
  return "browser";
}

export function detectEnv(userAgent?: string): IEnvInfo | null {
  const navigatorObj = getNavigator() ?? (typeof navigator !== "undefined" ? navigator : undefined);
  if (!userAgent && navigatorObj && (navigatorObj as any).product === "ReactNative") {
    return { name: "react-native" };
  }
  const ua = userAgent ?? navigatorObj?.userAgent;
  if (ua) {
    return { name: detectBrowserName(ua), os: detectOSFromUA(ua) };
  }
  if (typeof process !== "undefined" && process.versions?.node) {
    return { name: "node", version: process.versions.node, os: process.platform };
  }
  return null;
}

export function detectOS(): string | undefined {
  return detectEnv()?.os ?? undefined;
}

export function isAndroid(): boolean {
  const os = detectOS();
  return os ? os.toLowerCase().includes("android") : false;
}

export function isIOS(): boolean {
  const os = detectOS();
  const navigatorObj = getNavigator() ?? (typeof navigator !== "undefined" ? navigator : undefined);
  return os
    ? os.toLowerCase().includes("ios") ||
        (os.toLowerCase().includes("mac") && (navigatorObj?.maxTouchPoints ?? 0) > 1)
    : false;
}

export function isMobile(): boolean {
  return isAndroid() || isIOS();
}

export function isNode(): boolean {
  return detectEnv()?.name === "node";
}

export function isBrowser(): boolean {
  return !isNode() && !!getNavigator();
}
```

Note the test stubs `navigator` globally (not on `window`), so `env.ts` falls back to the bare `navigator` global when `window` is absent — exactly as written above.

- [ ] **Step 5: Write `src/browser/metadata.ts`** (vendored reimplementation of @walletconnect/window-metadata, MIT)

```ts
import type { IClientMeta } from "../types";
import { getDocumentOrThrow, getLocationOrThrow } from "./getters";

export function getWindowMetadata(): IClientMeta | null {
  let doc: Document;
  let loc: Location;
  try {
    doc = getDocumentOrThrow();
    loc = getLocationOrThrow();
  } catch {
    return null;
  }

  function getIcons(): string[] {
    const links = doc.getElementsByTagName("link");
    const icons: string[] = [];
    for (let i = 0; i < links.length; i++) {
      const link = links[i]!;
      const rel = link.getAttribute("rel");
      if (rel && rel.toLowerCase().includes("icon")) {
        const href = link.getAttribute("href");
        if (href) {
          if (
            !href.startsWith("https:") &&
            !href.startsWith("http:") &&
            !href.startsWith("//")
          ) {
            const path = href.startsWith("/")
              ? loc.protocol + "//" + loc.host + href
              : loc.protocol + "//" + loc.host + loc.pathname.replace(/\/[^/]*$/, "/") + href;
            icons.push(path);
          } else if (href.startsWith("//")) {
            icons.push(loc.protocol + href);
          } else {
            icons.push(href);
          }
        }
      }
    }
    return icons;
  }

  function getMetaOfAny(...args: string[]): string {
    const metaTags = doc.getElementsByTagName("meta");
    for (let i = 0; i < metaTags.length; i++) {
      const tag = metaTags[i]!;
      const attributes = ["itemprop", "property", "name"]
        .map(target => tag.getAttribute(target))
        .filter(attr => (attr ? args.includes(attr) : false));
      if (attributes.length && attributes[0]) {
        const content = tag.getAttribute("content");
        if (content) {
          return content;
        }
      }
    }
    return "";
  }

  const name = getMetaOfAny("name", "og:site_name", "og:title", "twitter:title") || doc.title;
  const description = getMetaOfAny("description", "og:description", "twitter:description", "keywords");

  return { description, url: loc.origin, icons: getIcons(), name };
}

export function getClientMeta(): IClientMeta | null {
  return getWindowMetadata();
}
```

- [ ] **Step 6: Write `src/browser/local.ts` and `src/browser/mobile.ts`**

`local.ts` — copy `packages/helpers/browser-utils/src/local.ts` verbatim, with imports changed to:

```ts
import { safeJsonParse, safeJsonStringify } from "../utils/json";
import { getLocalStorage } from "./getters";
```

`mobile.ts` — copy `packages/helpers/browser-utils/src/mobile.ts` verbatim, with imports changed to:

```ts
import type { IMobileLinkInfo, IMobileRegistry, IMobileRegistryEntry } from "../types";
import { setLocal } from "./local";
```

Do NOT port `registry.ts` (queries the dead ReOwn registry; its consumers were deleted in Task 1).

- [ ] **Step 7: Run test, expect PASS, commit**

```bash
pnpm -C packages/walletconnect exec vitest run test/browser.test.ts
git add -A && git commit -m "feat: port browser helpers, vendor window getters/metadata, replace detect-browser"
```

---

### Task 11: Transport (native WebSocket, mock-bridge tested)

**Files:**
- Create: `src/transport/network.ts`, `src/transport/socket.ts`, `test/mock-bridge.ts`
- Test: `test/transport.test.ts`

- [ ] **Step 1: Write the mock bridge test utility** (`test/mock-bridge.ts`)

This is also used by the interop suite. WC v1 bridge semantics: `sub` registers a socket for a topic and flushes cached messages; `pub` delivers to current subscribers of the topic or caches if none; `ack` is ignored.

```ts
import { WebSocketServer, WebSocket } from "ws";
import type { AddressInfo } from "node:net";

interface BridgeMessage {
  topic: string;
  type: "pub" | "sub" | "ack";
  payload: string;
  silent: boolean;
}

export class MockBridge {
  private wss: WebSocketServer;
  private subs = new Map<string, Set<WebSocket>>();
  private cache = new Map<string, BridgeMessage[]>();
  public messages: BridgeMessage[] = [];

  private constructor(wss: WebSocketServer) {
    this.wss = wss;
    wss.on("connection", socket => {
      socket.on("message", raw => {
        let message: BridgeMessage;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          return;
        }
        this.messages.push(message);
        if (message.type === "sub") {
          let topicSubs = this.subs.get(message.topic);
          if (!topicSubs) {
            topicSubs = new Set();
            this.subs.set(message.topic, topicSubs);
          }
          topicSubs.add(socket);
          const pending = this.cache.get(message.topic) ?? [];
          this.cache.delete(message.topic);
          for (const cached of pending) {
            socket.send(JSON.stringify(cached));
          }
        } else if (message.type === "pub") {
          const topicSubs = [...(this.subs.get(message.topic) ?? [])].filter(
            s => s.readyState === WebSocket.OPEN && s !== socket,
          );
          if (topicSubs.length) {
            for (const sub of topicSubs) {
              sub.send(JSON.stringify(message));
            }
          } else {
            const pending = this.cache.get(message.topic) ?? [];
            pending.push(message);
            this.cache.set(message.topic, pending);
          }
        }
        // "ack" intentionally ignored
      });
      socket.on("close", () => {
        for (const topicSubs of this.subs.values()) {
          topicSubs.delete(socket);
        }
      });
    });
  }

  static async start(): Promise<MockBridge> {
    const wss = new WebSocketServer({ port: 0 });
    await new Promise<void>(resolve => wss.on("listening", resolve));
    return new MockBridge(wss);
  }

  get url(): string {
    const { port } = this.wss.address() as AddressInfo;
    return `http://localhost:${port}`;
  }

  async close(): Promise<void> {
    for (const client of this.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve, reject) =>
      this.wss.close(err => (err ? reject(err) : resolve())),
    );
  }
}
```

- [ ] **Step 2: Write the failing transport test** (`test/transport.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import SocketTransport from "../src/transport/socket";
import { MockBridge } from "./mock-bridge";

function waitFor<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const interval = setInterval(() => {
      const result = check();
      if (result !== undefined) {
        clearInterval(interval);
        resolve(result);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(interval);
        reject(new Error("waitFor timed out"));
      }
    }, 25);
  });
}

describe("SocketTransport", () => {
  let bridge: MockBridge;
  let transports: SocketTransport[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    for (const t of transports) t.close();
    transports = [];
    await bridge.close();
  });

  function makeTransport(subscriptions: string[] = []) {
    const t = new SocketTransport({
      protocol: "wc",
      version: 1,
      url: bridge.url,
      subscriptions,
    });
    transports.push(t);
    return t;
  }

  it("throws on missing url", () => {
    expect(
      () => new SocketTransport({ protocol: "wc", version: 1, url: "" as string }),
    ).toThrowError(/url/i);
  });

  it("converts http(s) URLs to ws(s) and appends env params", async () => {
    const t = makeTransport(["topicA"]);
    t.open();
    await waitFor(() => (bridge.messages.some(m => m.type === "sub") ? true : undefined));
    expect(bridge.messages[0]).toMatchObject({ topic: "topicA", type: "sub", silent: true });
  });

  it("delivers pub messages to subscribers and acks", async () => {
    const a = makeTransport(["alice"]);
    const received: any[] = [];
    a.on("message", msg => received.push(msg));
    a.open();
    await waitFor(() => (bridge.messages.some(m => m.type === "sub") ? true : undefined));

    const b = makeTransport([]);
    b.open();
    b.send("hello", "alice", true);
    const msg = await waitFor(() => received[0]);
    expect(msg).toMatchObject({ topic: "alice", type: "pub", payload: "hello" });
    // transport acks every received message
    await waitFor(() =>
      bridge.messages.some(m => m.type === "ack" && m.topic === "alice") ? true : undefined,
    );
  });

  it("queues sends until the socket opens", async () => {
    const t = makeTransport([]);
    t.send("queued", "sometopic", true); // send before open: must queue + auto-create socket
    await waitFor(() =>
      bridge.messages.some(m => m.type === "pub" && m.payload === "queued") ? true : undefined,
    );
  });

  it("throws when sending without a topic", () => {
    const t = makeTransport([]);
    expect(() => t.send("x")).toThrowError(/topic/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/transport.test.ts`
Expected: FAIL — `src/transport/socket` not found.

- [ ] **Step 4: Write `src/transport/network.ts`**

Copy `packages/helpers/socket-transport/src/network.ts` verbatim, changing only the import to `import type { INetworkEventEmitter, INetworkMonitor, NetworkEvent } from "../types";`.

- [ ] **Step 5: Write `src/transport/socket.ts`**

Copy `packages/helpers/socket-transport/src/index.ts` with these changes and nothing else:

1. Imports become:

```ts
import type {
  INetworkMonitor,
  ISocketMessage,
  ISocketTransportOptions,
  ITransportEvent,
  ITransportLib,
} from "../types";
import { isBrowser, detectEnv } from "../browser/env";
import { getLocation } from "../browser/getters";
import { appendToQueryString, getQueryString } from "../utils/uri";
import NetworkMonitor from "./network";
```

2. Replace the `WS` resolution (old lines 18–19):

```ts
// old:
// // @ts-ignore
// const WS = typeof global.WebSocket !== "undefined" ? global.WebSocket : require("ws");

// new — native WebSocket only (browsers, React Native, Node >= 22):
function getWebSocketClass(): typeof WebSocket {
  if (typeof globalThis.WebSocket !== "undefined") {
    return globalThis.WebSocket;
  }
  throw new Error(
    "No WebSocket implementation found. Browsers, React Native, and Node.js >= 22 " +
      "provide one natively; upgrade Node or expose a global WebSocket.",
  );
}
```

and in `_socketCreate`, replace `this._nextSocket = new WS(url);` with `this._nextSocket = new (getWebSocketClass())(url);`.

3. Keep class body, reconnect semantics (1s retry on close), queueing, ack behavior, and `getWebSocketUrl` identical.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm -C packages/walletconnect exec vitest run test/transport.test.ts`
Expected: PASS. If the suite hangs after green tests, ensure `afterEach` closes every transport (the reconnect timer keeps the event loop alive otherwise).

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: port socket transport onto native WebSocket with mock-bridge tests"
```

---

### Task 12: Core (errors, events, storage, url, connector)

**Files:**
- Create: `src/core/errors.ts`, `src/core/events.ts`, `src/core/storage.ts`, `src/core/url.ts`, `src/core/connector.ts`
- Test: `test/core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import EventManager from "../src/core/events";
import SessionStorage from "../src/core/storage";
import { getBridgeUrl, extractRootDomain } from "../src/core/url";

describe("EventManager", () => {
  it("routes request payloads to method subscribers", () => {
    const em = new EventManager();
    const calls: any[] = [];
    em.subscribe({ event: "wc_sessionRequest", callback: (e, p) => calls.push([e, p]) });
    em.trigger({ id: 1, jsonrpc: "2.0", method: "wc_sessionRequest", params: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBeNull();
  });
  it("routes responses to response:<id> subscribers", () => {
    const em = new EventManager();
    const calls: any[] = [];
    em.subscribe({ event: "response:7", callback: (e, p) => calls.push(p) });
    em.trigger({ id: 7, jsonrpc: "2.0", result: "ok" });
    expect(calls[0].result).toBe("ok");
  });
  it("falls back to call_request for unknown non-reserved methods", () => {
    const em = new EventManager();
    const calls: any[] = [];
    em.subscribe({ event: "call_request", callback: (e, p) => calls.push(p) });
    em.trigger({ id: 1, jsonrpc: "2.0", method: "algo_signTxn", params: [] });
    expect(calls).toHaveLength(1);
  });
  it("converts error responses into Error callbacks", () => {
    const em = new EventManager();
    const calls: any[] = [];
    em.subscribe({ event: "response:9", callback: (e, p) => calls.push([e, p]) });
    em.trigger({ id: 9, jsonrpc: "2.0", error: { code: -32000, message: "boom" } });
    expect(calls[0][0]).toBeInstanceOf(Error);
    expect(calls[0][0].message).toBe("boom");
  });
});

describe("SessionStorage", () => {
  it("no-ops gracefully without localStorage", () => {
    const storage = new SessionStorage();
    expect(storage.getSession()).toBeNull();
    expect(() => storage.removeSession()).not.toThrow();
  });
});

describe("bridge url selection", () => {
  it("keeps non-walletconnect.org bridges untouched", () => {
    expect(getBridgeUrl("https://bridge.pera.example")).toBe("https://bridge.pera.example");
  });
  it("extractRootDomain", () => {
    expect(extractRootDomain("https://a.bridge.walletconnect.org/?x=1")).toBe("walletconnect.org");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/core.test.ts`
Expected: FAIL.

- [ ] **Step 3: Port the five core files**

- `src/core/errors.ts` ← copy `packages/clients/core/src/errors.ts` verbatim (no imports).
- `src/core/url.ts` ← copy `packages/clients/core/src/url.ts` verbatim (no imports).
- `src/core/events.ts` ← copy `packages/clients/core/src/events.ts`; imports become:

```ts
import type {
  IEventEmitter,
  IInternalEvent,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
} from "../types";
import {
  isInternalEvent,
  isJsonRpcRequest,
  isJsonRpcResponseError,
  isJsonRpcResponseSuccess,
  isReservedEvent,
} from "../utils/validators";
```

  One bug-compatible nuance: upstream calls `isInternalEvent(event)` (a string) in the fallback condition — with the typed signature that's `isInternalEvent(event as any)`. Keep the call (it is always falsy for strings, preserving behavior) with the cast, or drop it and add a comment `// upstream checked isInternalEvent(event) which is always false for strings` — either preserves behavior; prefer dropping with the comment.

- `src/core/storage.ts` ← copy `packages/clients/core/src/storage.ts`; imports become:

```ts
import type { ISessionStorage, IWalletConnectSession } from "../types";
import { getLocal, removeLocal, setLocal } from "../browser/local";
import { isWalletConnectSession } from "../utils/uri";
```

  and add `implements ISessionStorage` to the class declaration.

- `src/core/connector.ts` ← copy `packages/clients/core/src/index.ts` (the 1,277-line Connector). Change ONLY the import block (old lines 1–66) to:

```ts
import type {
  IClientMeta,
  IConnector,
  IConnectorOpts,
  ICreateSessionOptions,
  ICryptoLib,
  IEncryptionPayload,
  IInternalRequestOptions,
  IJsonRpcRequest,
  IJsonRpcResponseError,
  IJsonRpcResponseSuccess,
  IParseURIResult,
  IPushServerOptions,
  IPushSubscription,
  IQRCodeModal,
  IQRCodeModalOptions,
  IRequestOptions,
  ISessionError,
  ISessionParams,
  ISessionStatus,
  ISessionStorage,
  ISocketMessage,
  ITransportLib,
  ITxData,
  IUpdateChainParams,
  IWalletConnectSession,
} from "../types";
import {
  convertArrayBufferToHex,
  convertHexToArrayBuffer,
  convertNumberToHex,
} from "../utils/encoding";
import { payloadId, uuid } from "../utils/id";
import { formatRpcError } from "../utils/rpc";
import { parseWalletConnectUri } from "../utils/uri";
import {
  isJsonRpcResponseError,
  isJsonRpcResponseSuccess,
  isSilentPayload,
} from "../utils/validators";
import { signingMethods } from "../utils/constants";
import { parsePersonalSign, parseTransactionData } from "../utils/ethereum";
import { getClientMeta } from "../browser/metadata";
import { isMobile } from "../browser/env";
import { getLocal, removeLocal } from "../browser/local";
import { mobileLinkChoiceKey } from "../browser/mobile";
import SocketTransport from "../transport/socket";
import {
  ERROR_INVALID_RESPONSE,
  ERROR_INVALID_URI,
  ERROR_MISSING_ERROR,
  ERROR_MISSING_ID,
  ERROR_MISSING_JSON_RPC,
  ERROR_MISSING_METHOD,
  ERROR_MISSING_REQUIRED,
  ERROR_MISSING_RESULT,
  ERROR_QRCODE_MODAL_NOT_PROVIDED,
  ERROR_QRCODE_MODAL_USER_CLOSED,
  ERROR_SESSION_CONNECTED,
  ERROR_SESSION_DISCONNECTED,
  ERROR_SESSION_REJECTED,
} from "./errors";
import EventManager from "./events";
import SessionStorage from "./storage";
import { getBridgeUrl } from "./url";
```

  Everything below the import block stays byte-identical except strict-mode fixes: under `noUncheckedIndexedAccess`/`strict`, add minimal `!`/type assertions where tsc demands (e.g. `payload.params[0]` accesses). Do not restructure logic. `export default Connector;` stays.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm -C packages/walletconnect exec vitest run test/core.test.ts && pnpm -C packages/walletconnect typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: port core connector, events, storage, and bridge-url selection"
```

---

### Task 13: Client class and public entry point

**Files:**
- Create: `src/client/index.ts`
- Modify: `src/index.ts` (replace stub)
- Test: `test/client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import WalletConnect from "../src";
import type { IWalletConnectSession, ISessionStorage } from "../src/types";

const BRIDGE = "https://bridge.pera.example";

describe("WalletConnect client", () => {
  it("instantiates with a bridge and exposes WC v1 surface", () => {
    const connector = new WalletConnect({ bridge: BRIDGE });
    expect(connector.bridge).toBe(BRIDGE);
    expect(connector.protocol).toBe("wc");
    expect(connector.version).toBe(1);
    expect(connector.connected).toBe(false);
    expect(typeof connector.createSession).toBe("function");
    expect(typeof connector.killSession).toBe("function");
    expect(typeof connector.sendCustomRequest).toBe("function");
    expect(typeof connector.approveSession).toBe("function");
    connector.transportClose();
  });

  it("throws without bridge, uri, or session", () => {
    expect(() => new WalletConnect({})).toThrowError(/bridge \/ uri \/ session/);
  });

  it("restores a session from an injected storage adapter", () => {
    const session: IWalletConnectSession = {
      connected: true,
      accounts: ["ALGOADDRESS"],
      chainId: 4160,
      bridge: BRIDGE,
      key: "aa".repeat(32),
      clientId: "client-id",
      clientMeta: null,
      peerId: "peer-id",
      peerMeta: null,
      handshakeId: 1,
      handshakeTopic: "topic",
    };
    const storage: ISessionStorage = {
      getSession: () => session,
      setSession: s => s,
      removeSession: () => undefined,
    };
    const connector = new WalletConnect({ bridge: BRIDGE, storage });
    expect(connector.connected).toBe(true);
    expect(connector.accounts).toEqual(["ALGOADDRESS"]);
    expect(connector.session.key).toBe("aa".repeat(32));
    connector.transportClose();
  });

  it("parses a wc: uri", () => {
    const key = "bb".repeat(32);
    const connector = new WalletConnect({
      uri: `wc:topic-x@1?bridge=${encodeURIComponent(BRIDGE)}&key=${key}`,
    });
    expect(connector.bridge).toBe(BRIDGE);
    expect(connector.handshakeTopic).toBe("topic-x");
    expect(connector.key).toBe(key);
    connector.transportClose();
  });

  it("fails fast with a clear error when crypto.getRandomValues is missing", () => {
    const original = globalThis.crypto;
    vi.stubGlobal("crypto", undefined);
    try {
      expect(() => new WalletConnect({ bridge: BRIDGE })).toThrowError(/getRandomValues/);
    } finally {
      vi.stubGlobal("crypto", original);
    }
  });
});
```

Note: instantiation opens a real socket to `bridge.pera.example` which fails in CI — that's fine; the transport swallows connection errors and retries in background, and `transportClose()` stops it. If the reconnect timer keeps vitest alive, close transports in the test as shown.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/walletconnect exec vitest run test/client.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/client/index.ts`**

```ts
import Connector from "../core/connector";
import * as cryptoLib from "../crypto";
import type { IPushServerOptions, IWalletConnectOptions } from "../types";

class WalletConnect extends Connector {
  constructor(connectorOpts: IWalletConnectOptions, pushServerOpts?: IPushServerOptions) {
    if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
      throw new Error(
        "crypto.getRandomValues is not available. In React Native, install a polyfill " +
          "such as react-native-quick-crypto or react-native-get-random-values before " +
          "constructing WalletConnect.",
      );
    }
    super({
      cryptoLib,
      connectorOpts,
      sessionStorage: connectorOpts.storage,
      pushServerOpts,
    });
  }
}

export default WalletConnect;
```

(`IConnectorOpts.sessionStorage` already exists in the types; passing `connectorOpts.storage` through enables the RN storage adapter added in Task 4.)

- [ ] **Step 4: Replace `src/index.ts`**

```ts
import WalletConnect from "./client";

export * from "./types";
export default WalletConnect;
```

- [ ] **Step 5: Run tests, build, publint**

```bash
pnpm -C packages/walletconnect exec vitest run
pnpm -C packages/walletconnect build
pnpm -C packages/walletconnect exec publint
```
Expected: all tests pass, dist contains `index.js`, `index.cjs`, `index.d.ts`, `types/index.*`; publint reports no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add WalletConnect client class and public package entry point"
```

---

### Task 14: Golden interop suite (oracle: @walletconnect/client@1.8.0)

**Files:**
- Test: `test/interop/crypto-interop.test.ts`, `test/interop/session-interop.test.ts`

- [ ] **Step 1: Write the crypto interop test** (`test/interop/crypto-interop.test.ts`)

```ts
import { describe, it, expect } from "vitest";
// eslint-disable-next-line import/no-extraneous-dependencies -- interop oracle
import * as legacyCrypto from "@walletconnect/crypto";
import { encrypt, decrypt, generateKey } from "../../src/crypto";
import { hexToArray, arrayToHex } from "../../src/utils/encoding";

const REQUEST = { id: 42, jsonrpc: "2.0", method: "wc_test", params: [{ pera: true }] };

describe("crypto interop with @walletconnect/crypto", () => {
  it("legacy primitives and new primitives agree on AES-CBC + HMAC", async () => {
    const key = new Uint8Array(await generateKey());
    const iv = new Uint8Array(await generateKey(128));
    const data = new TextEncoder().encode(JSON.stringify(REQUEST));

    const legacyCipher = await legacyCrypto.aesCbcEncrypt(iv, key, data);
    const newPayload = await encrypt(REQUEST as any, key.buffer as ArrayBuffer, iv.buffer as ArrayBuffer);
    expect(newPayload.data).toBe(arrayToHex(new Uint8Array(legacyCipher)));

    const legacyHmac = await legacyCrypto.hmacSha256Sign(
      key,
      new Uint8Array([...new Uint8Array(legacyCipher), ...iv]),
    );
    expect(newPayload.hmac).toBe(arrayToHex(new Uint8Array(legacyHmac)));
  });

  it("new client decrypts what legacy encrypts (via primitives) and vice versa", async () => {
    const key = new Uint8Array(await generateKey());
    const payload = await encrypt(REQUEST as any, key.buffer as ArrayBuffer);
    const legacyPlain = await legacyCrypto.aesCbcDecrypt(
      hexToArray(payload.iv),
      key,
      hexToArray(payload.data),
    );
    expect(JSON.parse(new TextDecoder().decode(new Uint8Array(legacyPlain)))).toEqual(REQUEST);

    const roundTrip = await decrypt(payload, key.buffer as ArrayBuffer);
    expect(roundTrip).toEqual(REQUEST);
  });
});
```

If `@walletconnect/crypto`'s exact export shapes differ (it returns `Buffer`s in Node), wrap results in `new Uint8Array(...)` as shown. Check its API with `node -e "console.log(Object.keys(require('@walletconnect/crypto')))"` if imports fail.

- [ ] **Step 2: Write the session interop test** (`test/interop/session-interop.test.ts`)

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
// eslint-disable-next-line import/no-extraneous-dependencies -- interop oracle
import LegacyWalletConnect from "@walletconnect/client";
import WalletConnect from "../../src";
import { MockBridge } from "../mock-bridge";

const CLIENT_META = {
  description: "test wallet",
  url: "https://pera.test",
  icons: [],
  name: "Pera Test",
};

function nextEvent(connector: any, event: string): Promise<any> {
  return new Promise((resolve, reject) => {
    connector.on(event, (error: Error | null, payload: any) => {
      if (error) reject(error);
      else resolve(payload);
    });
  });
}

describe("session interop: legacy dapp ↔ new wallet", () => {
  let bridge: MockBridge;
  const connectors: any[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    for (const c of connectors) {
      try {
        c.transportClose();
      } catch {
        /* already closed */
      }
    }
    connectors.length = 0;
    await bridge.close();
  });

  it("full lifecycle: connect, custom request, update, kill", async () => {
    // 1. legacy dapp creates a session
    const dapp = new LegacyWalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: { open: () => undefined, close: () => undefined },
    });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 4160 });
    expect(dapp.uri).toMatch(/^wc:/);

    // 2. new wallet joins from the URI and receives the session request
    const wallet = new WalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    const sessionRequest = nextEvent(wallet, "session_request");
    const connected = nextEvent(dapp, "connect");
    const requestPayload = await sessionRequest;
    expect(requestPayload.params[0].peerMeta.name).toBe("Pera Test");
    expect(requestPayload.params[0].chainId).toBe(4160);

    // 3. wallet approves; dapp sees connect with accounts
    wallet.approveSession({ accounts: ["PERAACCOUNT1"], chainId: 4160 });
    const connectPayload = await connected;
    expect(connectPayload.params[0].accounts).toEqual(["PERAACCOUNT1"]);
    expect(dapp.connected).toBe(true);
    expect(wallet.connected).toBe(true);

    // 4. dapp sends a custom request (pera-connect's exact call shape)
    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest(
      { method: "algo_signTxn", params: [[{ txn: "b64" }]] },
      { forcePushNotification: true },
    );
    const call = await callRequest;
    expect(call.method).toBe("algo_signTxn");
    wallet.approveRequest({ id: call.id, result: ["signed"] });
    expect(await resultPromise).toEqual(["signed"]);

    // 5. wallet pushes a session update
    const updated = nextEvent(dapp, "session_update");
    wallet.updateSession({ accounts: ["PERAACCOUNT2"], chainId: 4160 });
    expect((await updated).params[0].accounts).toEqual(["PERAACCOUNT2"]);

    // 6. dapp kills the session; wallet sees disconnect
    const disconnected = nextEvent(wallet, "disconnect");
    await dapp.killSession();
    await disconnected;
    expect(wallet.connected).toBe(false);
  }, 30_000);
});

describe("session interop: new dapp ↔ legacy wallet", () => {
  let bridge: MockBridge;
  const connectors: any[] = [];

  beforeEach(async () => {
    bridge = await MockBridge.start();
  });
  afterEach(async () => {
    for (const c of connectors) {
      try {
        c.transportClose();
      } catch {
        /* already closed */
      }
    }
    connectors.length = 0;
    await bridge.close();
  });

  it("full lifecycle in the reverse orientation", async () => {
    const dapp = new WalletConnect({
      bridge: bridge.url,
      clientMeta: CLIENT_META,
      qrcodeModal: { open: () => undefined, close: () => undefined },
    });
    connectors.push(dapp);
    await dapp.createSession({ chainId: 4160 });

    const wallet = new LegacyWalletConnect({ uri: dapp.uri, clientMeta: CLIENT_META });
    connectors.push(wallet);
    const requestPayload = await nextEvent(wallet, "session_request");
    expect(requestPayload.params[0].chainId).toBe(4160);

    const connected = nextEvent(dapp, "connect");
    wallet.approveSession({ accounts: ["LEGACYACCOUNT"], chainId: 4160 });
    expect((await connected).params[0].accounts).toEqual(["LEGACYACCOUNT"]);

    const callRequest = nextEvent(wallet, "call_request");
    const resultPromise = dapp.sendCustomRequest({ method: "algo_signTxn", params: [[]] });
    const call = await callRequest;
    wallet.approveRequest({ id: call.id, result: ["ok"] });
    expect(await resultPromise).toEqual(["ok"]);

    const disconnected = nextEvent(wallet, "disconnect");
    await dapp.killSession();
    await disconnected;
  }, 30_000);
});
```

Notes for the implementer:
- The legacy client resolves `require("ws")` in Node — `ws` is in devDependencies, so this works.
- Both clients run in one process with no `localStorage`, so session persistence is a no-op (intended).
- If the legacy dapp's `createSession` hangs: its transport sends `sub` for its clientId on open; the MockBridge must already be listening (it is — `start()` awaits `listening`).

- [ ] **Step 3: Run the interop suite**

Run: `pnpm -C packages/walletconnect exec vitest run test/interop`
Expected: PASS — this is the proof of wire compatibility. Debug failures by inspecting `bridge.messages`.

- [ ] **Step 4: Run the whole suite with coverage**

Run: `pnpm -C packages/walletconnect test:coverage`
Expected: PASS with thresholds met. If coverage is short, the uncovered lines are usually in `connector.ts` convenience methods (`sendTransaction`, `signMessage`, etc.) — add a small unit test calling each against a connected stub transport, or lower per-file expectations consciously (do not drop below 75).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "test: add golden interop suite against @walletconnect/client@1.8.0 oracle"
```

---

### Task 15: Consumer-surface compile check (pera-connect contract)

**Files:**
- Create: `test/consumer/surface.ts`, `test/consumer/tsconfig.json`

- [ ] **Step 1: Write `test/consumer/surface.ts`** — every line mirrors an actual pera-connect usage:

```ts
// Compile-only contract test: the exact API surface pera-connect (../connect)
// uses. If this file stops compiling, pera-connect breaks.
import WalletConnect from "@perawallet/walletconnect";
import type { IWalletConnectSession } from "@perawallet/walletconnect/types";

export function peraConnectSurface(): void {
  const connector = new WalletConnect({
    bridge: "https://bridge.example.org",
    qrcodeModal: {
      open: (_uri: string, _cb: unknown, _opts?: unknown) => undefined,
      close: () => undefined,
    },
  });

  void new WalletConnect({ bridge: "https://bridge.example.org" });

  void connector.createSession({ chainId: 4160 });
  void connector.killSession();
  void connector.sendCustomRequest(
    { method: "algo_signTxn", params: [] },
    { forcePushNotification: true },
  );
  connector.on("connect", (error: Error | null, payload: unknown) => {
    void error;
    void payload;
  });

  const connected: boolean = connector.connected;
  const accounts: string[] = connector.accounts;
  const bridge: string = connector.bridge;
  void connected;
  void accounts;
  void bridge;

  const session: IWalletConnectSession = connector.session;
  void session;
}
```

- [ ] **Step 2: Write `test/consumer/tsconfig.json`** (resolves the package name to built dist):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "paths": {
      "@perawallet/walletconnect": ["../../dist/index.d.ts"],
      "@perawallet/walletconnect/types": ["../../dist/types/index.d.ts"]
    }
  },
  "include": ["surface.ts"]
}
```

- [ ] **Step 3: Add script to `packages/walletconnect/package.json`**

```json
"test:consumer": "pnpm build && tsc -p test/consumer/tsconfig.json"
```

- [ ] **Step 4: Run and commit**

```bash
pnpm -C packages/walletconnect test:consumer
git add -A && git commit -m "test: add pera-connect API surface compile check"
```

---

### Task 16: Delete legacy package sources

**Files:**
- Delete: `packages/clients/`, `packages/helpers/`, root `tsconfig.json` (lerna-era), `CHANGES.md` (upstream changelog — superseded; keep only if you want history, decide: delete)

- [ ] **Step 1: Verify nothing references the old paths**

```bash
grep -rn "packages/clients\|packages/helpers" packages/walletconnect/src packages/walletconnect/test .github 2>/dev/null
```
Expected: no output.

- [ ] **Step 2: Delete**

```bash
git rm -r packages/clients packages/helpers
git rm -f tsconfig.json CHANGES.md
```

- [ ] **Step 3: Full verification**

```bash
pnpm install
pnpm typecheck && pnpm test && pnpm build
```
Expected: lockfile prunes legacy deps, everything green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: remove legacy package sources after port"
```

---

### Task 17: Lint and format (oxlint + oxfmt)

**Files:**
- Create: `.oxlintrc.json` (root)

- [ ] **Step 1: Copy and adapt pera-rn's config**

```bash
cp ../pera-rn/.oxlintrc.json .oxlintrc.json
```
Open it and remove react/react-native-specific plugin sections (`react` plugin entries) — keep `typescript`, `unicorn`, and `unused-imports` rules. If pera-rn's config references project-local paths or its devtools, strip those references.

- [ ] **Step 2: Run lint and format, fix findings**

```bash
pnpm lint
pnpm format
```
Fix any reported issues (most likely: `any` usage in ported connector code — suppress with targeted `// oxlint-disable-next-line` comments rather than weakening rules; the ported code keeps upstream's loose `any` payloads by design).

- [ ] **Step 3: Verify clean and commit**

```bash
pnpm lint && pnpm format:check && pnpm test
git add -A && git commit -m "chore: adopt oxlint and oxfmt with pera-rn rule set"
```

---

### Task 18: CI — pre-merge workflow

**Files:**
- Create: `.github/workflows/pre-merge.yml`

- [ ] **Step 1: Collect pinned action SHAs from pera-rn**

```bash
grep -rhoE "uses: [^ ]+@[a-f0-9]{40}.*" ../pera-rn/.github/workflows/ | sort -u
```
Keep this mapping at hand. Every `uses:` below must be pinned to a full commit SHA — take the SHA for the same action from pera-rn's workflows. For any action pera-rn does not use, resolve the SHA for the latest release tag: `gh api repos/<owner>/<action>/git/ref/tags/<tag> --jq .object.sha` (and dereference annotated tags with `gh api repos/<owner>/<action>/git/tags/<sha> --jq .object.sha` if the first returns a tag object).

- [ ] **Step 2: Write `.github/workflows/pre-merge.yml`**

```yaml
name: pre-merge

on:
  pull_request:
  push:
    branches: [main, v1]

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<SHA from pera-rn>
      - uses: pnpm/action-setup@<SHA from pera-rn>
      - uses: actions/setup-node@<SHA from pera-rn>
        with:
          node-version-file: ".tool-versions"
          cache: pnpm
      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile
      - name: Audit runtime dependencies (moderate+)
        run: pnpm audit --prod --audit-level moderate
      - name: Audit all dependencies (low+)
        run: pnpm audit --audit-level low
      - name: Lint
        run: pnpm lint
      - name: Format check
        run: pnpm format:check
      - name: Typecheck
        run: pnpm typecheck
      - name: Build
        run: pnpm build
      - name: Package lint (publint + tarball check)
        run: |
          pnpm -C packages/walletconnect exec publint
          pnpm -C packages/walletconnect pack --out /tmp/pkg.tgz
          tar -tzf /tmp/pkg.tgz | grep -v '^package/\(dist/\|package.json\|README.md\|LICENSE\|NOTICE\)' \
            && { echo "Unexpected files in tarball"; exit 1; } || true
      - name: Consumer surface check
        run: pnpm -C packages/walletconnect test:consumer
      - name: Test with coverage
        run: pnpm test:coverage
```

Replace each `<SHA from pera-rn>` with the actual 40-char SHA (plus a trailing `# vX.Y.Z` comment) from Step 1. Mirror the exact audit-step semantics used in pera-rn's pre-merge.yml if they differ (runtime: moderate+, all: low) — read `../pera-rn/.github/workflows/pre-merge.yml` and copy its audit invocation verbatim.

- [ ] **Step 3: Validate and commit**

```bash
gh workflow list 2>/dev/null || true  # syntax is validated on push
git add -A && git commit -m "ci: add pre-merge workflow with audit, lint, build, packaging, and coverage gates"
```

---

### Task 19: CI — CodeQL, Scorecard, SBOM

**Files:**
- Create: `.github/workflows/codeql.yml`, `.github/workflows/scorecard.yml`, `.github/workflows/sbom.yml`

- [ ] **Step 1: Copy the three workflows from pera-rn and adapt**

```bash
cp ../pera-rn/.github/workflows/codeql.yml .github/workflows/codeql.yml
cp ../pera-rn/.github/workflows/scorecard.yml .github/workflows/scorecard.yml
cp ../pera-rn/.github/workflows/sbom.yml .github/workflows/sbom.yml
```

Adapt each: change branch filters to this repo's default branch, remove pera-rn-specific paths/filters (e.g. mobile app excludes), keep schedules, pinned SHAs, `permissions:` blocks, and the `security-extended` CodeQL query pack as-is.

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "ci: add CodeQL, OpenSSF Scorecard, and SBOM workflows"
```

---

### Task 20: Release workflow (OIDC trusted publishing + provenance)

**Files:**
- Create: `.github/workflows/release.yml`, `RELEASING.md`

- [ ] **Step 1: Write `.github/workflows/release.yml`** (pin SHAs as in Task 18)

```yaml
name: release

on:
  push:
    tags: ["v*"]

permissions:
  contents: read

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: npm-publish
    permissions:
      contents: read
      id-token: write # OIDC trusted publishing + provenance
    steps:
      - uses: actions/checkout@<SHA>
      - uses: pnpm/action-setup@<SHA>
      - uses: actions/setup-node@<SHA>
        with:
          node-version-file: ".tool-versions"
          cache: pnpm
          registry-url: "https://registry.npmjs.org"
      - name: Install (frozen lockfile)
        run: pnpm install --frozen-lockfile
      - name: Verify tag matches package version
        run: |
          PKG_VERSION=$(node -p "require('./packages/walletconnect/package.json').version")
          [ "v$PKG_VERSION" = "${GITHUB_REF_NAME}" ] || { echo "Tag ${GITHUB_REF_NAME} != package version v$PKG_VERSION"; exit 1; }
      - name: Build and verify
        run: pnpm typecheck && pnpm test && pnpm build && pnpm -C packages/walletconnect exec publint
      - name: Update npm for OIDC support
        run: npm install -g npm@latest && npm --version # OIDC trusted publishing requires npm >= 11.5.1
      - name: Publish with provenance (OIDC, no token)
        working-directory: packages/walletconnect
        run: npm publish --provenance --access public
```

No `NODE_AUTH_TOKEN` anywhere — authentication is the OIDC exchange.

- [ ] **Step 2: Write `RELEASING.md`**

```markdown
# Releasing @perawallet/walletconnect

## One-time npm setup (manual, requires npm org owner)

1. On npmjs.com → package settings → **Trusted Publisher**:
   - Provider: GitHub Actions
   - Organization/user: `perawallet`
   - Repository: `pera-walletconnect-ts`
   - Workflow filename: `release.yml`
   - Environment: `npm-publish`
2. Package settings → **Publishing access**: require two-factor authentication
   and disallow tokens (trusted publisher only).
   First-ever publish of a new package name cannot use a trusted publisher;
   do the initial `npm publish --provenance --access public` locally with an
   npm account that has 2FA, then immediately configure the trusted publisher
   and disable token publishing.

## One-time GitHub setup

1. Settings → Environments → create `npm-publish`; add required reviewers
   (release approvers).
2. Branch protection on the default branch: require pre-merge checks.

## Each release

1. Bump `version` in `packages/walletconnect/package.json` via PR.
2. After merge: `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. Approve the `npm-publish` environment run when prompted.
4. Verify the provenance badge on https://www.npmjs.com/package/@perawallet/walletconnect.
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "ci: add OIDC trusted-publishing release workflow with provenance"
```

---

### Task 21: README, NOTICE, repo hygiene

**Files:**
- Modify: `README.md` (full rewrite)
- Create: `NOTICE`, `packages/walletconnect/README.md` (symlink-free copy or short pointer)
- Keep: `LICENSE` (Apache-2.0, unchanged)

- [ ] **Step 1: Write `NOTICE`**

```
@perawallet/walletconnect
Copyright 2026 Pera Wallet

This product is a fork and modernization of WalletConnect v1.x
(https://github.com/WalletConnect/walletconnect-monorepo),
Copyright 2020 WalletConnect, licensed under the Apache License 2.0.

It includes reimplementations of the following MIT-licensed WalletConnect
helper packages, vendored as internal modules:
  @walletconnect/safe-json, @walletconnect/window-getters,
  @walletconnect/window-metadata, @walletconnect/encoding,
  @walletconnect/jsonrpc-utils (payloadId), @walletconnect/crypto (API shape)
```

- [ ] **Step 2: Rewrite root `README.md`** covering: what the package is (Pera-maintained WC v1 client, wallet + dapp side), why (v1-pinned backend, ReOwn walled garden), install (`pnpm add @perawallet/walletconnect`), wallet-side usage example (constructor with `uri` + `storage` adapter, `approveSession`, `approveRequest`), dapp-side usage example (constructor with `bridge` + `qrcodeModal`, `createSession`, `sendCustomRequest`), React Native requirements (`crypto.getRandomValues` polyfill), Node >= 22 note, security posture summary (deps: @noble only; interop-tested wire compat; OIDC provenance publishing), and development commands. Also copy this `README.md` into `packages/walletconnect/README.md` so it ships in the tarball.

- [ ] **Step 3: Final full check and commit**

```bash
pnpm install --frozen-lockfile && pnpm lint && pnpm format:check && pnpm typecheck && pnpm build && pnpm test:coverage && pnpm -C packages/walletconnect test:consumer
git add -A && git commit -m "docs: rewrite README for @perawallet/walletconnect, add NOTICE attribution"
```

---

## Success criteria (from spec)

1. `@perawallet/walletconnect@1.0.0` builds (ESM+CJS+types) and passes lint/typecheck/tests in CI — Tasks 3–18.
2. Interop suite green in both orientations against original 1.8.0 packages — Task 14.
3. Runtime dep tree is exactly `@noble/ciphers` + `@noble/hashes` — verify: `pnpm -C packages/walletconnect ls --prod --depth 10`.
4. pera-connect compiles against it with only an import rename — Task 15 (compile-contract proxy).
5. First npm publish succeeds via OIDC with provenance — Task 20 + RELEASING.md manual steps.
