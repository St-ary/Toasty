# Working with Toasty on GitHub

This is the "GitHub part" of contributing: how to find the repo, report things,
send pull requests, and get code merged. Setup and style rules live in
[CONTRIBUTING.md](../CONTRIBUTING.md).

## Find the repo

Everything lives at [github.com/stary/toasty](https://github.com/stary/toasty):
source, docs, issues, and releases. Browse the code, read the docs under `docs/`,
and check the [issue tracker](https://github.com/stary/toasty/issues) before
opening a new one.

## Create an issue

Use the templates — they make issues far easier to act on:

- **Bug report** — what broke, how to reproduce it, expected vs. actual behavior,
  environment (self-hosted or vault.stary.lol, browser, version).
- **Feature request** — the problem you're solving, your proposed solution, and
  alternatives you considered.

Search existing issues first; add a comment to an existing issue rather than
opening a duplicate.

## Fork and clone

```bash
git clone https://github.com/<your-username>/toasty.git
cd toasty
git remote add upstream https://github.com/stary/toasty.git
git remote -v          # origin = your fork, upstream = stary/toasty
```

## Create a branch

One branch per change, named for what it does:

```bash
git switch main
git pull upstream main
git switch -c feature/my-change
```

Conventions: `feature/...`, `fix/...`, `docs/...`, `chore/...`.

## Make commits

```bash
git add apps/web/src/vault.ts docs/self-hosting.md
git commit -m "Fix vault sync race when items change during a pull"
```

Keep commits focused and write imperative subject lines. Run the checks locally
before committing anything non-trivial:

```bash
npm run typecheck
npm test
```

## Push and open a pull request

```bash
git push -u origin feature/my-change
```

Open a pull request against `stary/toasty:main`, fill in the PR template, and link
the issue it resolves with `Fixes #123` in the description — GitHub then closes
the issue automatically on merge.

## What CI checks

Every push and pull request runs the GitHub Actions workflow
(`.github/workflows/ci.yml`) on Node 22:

| Step | Command |
| --- | --- |
| Install | `npm ci --include=dev` |
| Build crypto | `npm run build:crypto` |
| Typecheck | `npm run typecheck` |
| Build | `npm run build` |
| Test | `npm test` |

All steps must be green before merging. If a check fails, the log tells you which
workspace it came from — fix locally and push again; the PR updates automatically.

## Code review

Be kind and specific; we're all here because we like warm, encrypted toast. One
approval is required before merging. Expect questions — they're about the code,
not about you — and answer them in the PR thread so future readers can follow.

## Merging

Squash merge is preferred: one commit per change on `main`, with a clear subject
line (usually the PR title plus `(#123)`). Delete the branch after merging.

## Releases

Maintainers cut releases periodically:

1. Bump the version in `package.json` (semver, e.g. `0.2.0`).
2. Tag and push: `git tag v0.2.0 && git push origin v0.2.0`.
3. Publish a GitHub Release with notes (features, fixes, breaking changes).
4. Publish the Docker image tagged `ghcr.io/stary/toasty:0.2.0` and `:latest`.

## Keep your fork in sync

```bash
git switch main
git pull upstream main
git push origin main
```

Rebase open feature branches onto the fresh `main` before updating their PRs:

```bash
git switch feature/my-change
git rebase main
git push --force-with-lease
```
