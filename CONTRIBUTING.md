# Contributing to RSEA Agent

Thank you for your interest in contributing! Please follow the guidelines below to keep the project healthy and safe.

## Development Setup

```bash
npm ci          # install dependencies
npm run dev     # start the dev server (requires .env — see .env.example)
npm run lint    # type-check (tsc --noEmit)
npm run test    # run the test suite
```

## Environment Variables

Copy `.env.example` to `.env` and fill in the values you need. **Never commit a `.env` file with real secrets.**

## Coding Standards

- **TypeScript** — all new source files must be `.ts`/`.tsx`. The lint step (`npm run lint`) runs `tsc --noEmit`; it must pass before merging.
- **Tests** — every new behaviour should be covered by a unit test under `tests/`. Coverage thresholds are 75 % statements/functions/lines and 70 % branches (enforced by `npm run test:coverage`).
- **Security gates** — `ALLOW_CODE_EVAL`, `ALLOW_SELF_MODIFICATION`, and `DRY_RUN` must default to the safe value (`false` / `true`). Do not change these defaults without a security review.
- **No secrets in source** — API keys, tokens, and passwords must come from environment variables only.

## Pull Requests

1. Fork the repository and create a feature branch from `main`.
2. Keep changes small and focused; one logical change per PR.
3. Fill in the PR template fully, including the security checklist.
4. All CI checks (lint, tests, build) must pass before review.
5. At least one maintainer approval is required to merge.

## Reporting Issues

Open a GitHub Issue. For security vulnerabilities, see [SECURITY.md](SECURITY.md) instead — do **not** use public issues for security reports.
