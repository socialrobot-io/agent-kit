# Publishing

For maintainers. Consumers install from npm; they do not need this guide.

Publish all `@socialrobot-io/agent-kit-*` packages together with one shared
version. Releases run from GitHub Actions on `main` (manual “Run workflow”).
Auth uses npm Trusted Publishing (OIDC). There is no long-lived `NPM_TOKEN`.

## Naming

| Layer | Name | Role |
| ----- | ---- | ---- |
| npm / GitHub org | `socialrobot-io` | Owns the scope and the repo |
| Package names | `@socialrobot-io/agent-kit-*` | What consumers install and import |

Example import:

```ts
import { createTenantHome } from "@socialrobot-io/agent-kit-node";
```

## Packages

| Package | Project |
| ------- | ------- |
| `@socialrobot-io/agent-kit-node` | `node` |
| `@socialrobot-io/agent-kit-core` | `core` |
| `@socialrobot-io/agent-kit-ai` | `ai` |
| `@socialrobot-io/agent-kit-sessions` | `sessions` |
| `@socialrobot-io/agent-kit-sandbox` | `sandbox` |
| `@socialrobot-io/agent-kit-curator` | `curator` |
| `@socialrobot-io/agent-kit-cli` | `cli` |

All seven share one version. A bump updates every package.

## One-time npm setup

1. Confirm you can publish under the `socialrobot-io` organization on
   [npmjs.com](https://www.npmjs.com).
2. For each package above, add a Trusted Publisher:
   - Organization or user: `socialrobot-io`
   - Repository: `agent-kit`
   - Workflow filename: `release.yml`
   - Environment: leave empty
3. You can add Trusted Publishers before the first publish when you own the
   scope. If npm requires an existing package, publish once with a granular
   token, then switch to OIDC and revoke the token.

npm provenance attestations need a public GitHub repository. This repo can stay
private; publishes still work, but provenance is omitted until the repo is
public.

## Run a release

1. Merge the work you want to ship into `main`.
2. Open Actions → **Release** → **Run workflow**.
3. Set inputs:
   - `specifier`: `patch`, `minor`, `major`, or an exact version such as
     `0.1.0`
   - `first_release`: `true` only for the first publish (no `v*` tag yet).
     For the initial `0.1.0` publish, use specifier `0.1.0` and
     `first_release: true`.
   - `dry_run`: `true` to preview without commit, tag, push, or publish
4. The workflow tests, builds, emits `.d.ts` files, versions, updates
   `CHANGELOG.md`, creates a GitHub Release, rewrites `workspace:*` deps to
   concrete versions for the npm tarball only, then publishes each package.

Local preview (no publish):

```bash
bunx nx release patch --first-release --dry-run
```

## Workspace deps and publish

Git keeps `"workspace:*"` so Bun links local packages. npm rejects that
protocol in published tarballs. The Release workflow therefore:

1. Runs `nx release … --skip-publish` (version + changelog + tag stay on git
   with `workspace:*`).
2. Runs `bun scripts/rewrite-workspace-deps-for-publish.mjs` (working tree only).
3. Runs `nx release publish`.

Do not commit the rewritten `package.json` files. Do not set
`release.version.preserveLocalDependencyProtocols: false` in `nx.json`; that
would commit concrete versions and break local workspace installs.

## Notes

- The workflow refuses to run on branches other than `main`.
- Do not set `NODE_AUTH_TOKEN` in the release job. The npm CLI uses OIDC when
  `id-token: write` is present and Trusted Publishing is configured.
- Require npm CLI `>= 11.5.1` (the workflow installs latest npm on Node 24).
- Packages are public (`publishConfig.access: public`). After any one-off
  granular token publish, revoke that token on npm.
