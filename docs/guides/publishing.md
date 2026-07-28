# Publishing

Publish `@socialrobot-io/agent-kit-*` packages to the public npm registry with a
shared version. Releases run from GitHub Actions on `main` via manual dispatch.
Auth uses npm Trusted Publishing (OIDC). There is no long-lived `NPM_TOKEN`.

## Naming

| Layer | Name | Role |
| ----- | ---- | ---- |
| npm / GitHub org | `socialrobot-io` | Owns the scope and the repo |
| Package names | `@socialrobot-io/agent-kit-*` | What consumers install and import |

Example import:

```ts
import { defineAgent } from "@socialrobot-io/agent-kit-core";
import { runAgentTurn } from "@socialrobot-io/agent-kit-ai";
```

## Packages

| Package | Project |
| ------- | ------- |
| `@socialrobot-io/agent-kit-core` | `core` |
| `@socialrobot-io/agent-kit-ai` | `ai` |
| `@socialrobot-io/agent-kit-sessions` | `sessions` |
| `@socialrobot-io/agent-kit-sandbox` | `sandbox` |
| `@socialrobot-io/agent-kit-curator` | `curator` |
| `@socialrobot-io/agent-kit-cli` | `cli` |

All six share one version. A bump updates every package.

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
   `CHANGELOG.md`, creates a GitHub Release, and runs `npm publish` for each
   package.

Local preview (no publish):

```bash
bunx nx release patch --first-release --dry-run
```

## Notes

- The workflow refuses to run on branches other than `main`.
- Do not set `NODE_AUTH_TOKEN` in the release job. The npm CLI uses OIDC when
  `id-token: write` is present and Trusted Publishing is configured.
- Require npm CLI `>= 11.5.1` (the workflow installs latest npm on Node 24).
