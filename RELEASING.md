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
