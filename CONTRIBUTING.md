# Contributing to Toasty

Thanks for wanting to make Toasty better. Keep it kind and constructive in issues,
pull requests, and reviews — harassment or personal attacks are not tolerated.

## Development setup

```bash
git clone https://github.com/<your-username>/toasty.git
cd toasty
npm install --include=dev
docker compose up db        # Postgres
npm run dev:server          # API on http://localhost:8787
npm run dev:web             # web vault on http://localhost:5173
```

## Branches and pull requests

Work on a branch (`git switch -c feature/my-change`), push it to your fork, and open
a pull request with the PR template filled in. The full GitHub workflow — issues,
forks, CI, review, releases — is in
[docs/github-workflow.md](docs/github-workflow.md). One approval is required before
merging; squash merge is preferred.

## Style rules

- TypeScript in strict mode; no `any` without a written reason.
- No comments unless the code genuinely can't speak for itself.
- Tests are required for any change to `packages/crypto` or authentication code.
- Run `npm run typecheck` and `npm test` before pushing.

## Security disclosure

Do not file public issues for vulnerabilities. Email
[security@stary.lol](mailto:security@stary.lol) with a description and reproduction
steps, and we'll work with you on a fix and disclosure timeline.
