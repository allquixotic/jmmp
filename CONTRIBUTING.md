# Contributing to jmmp

jmmp is a Bun, Vue 3, and Quasar application. The repository is split into
three workspaces:

- `shared`: API contracts and common domain types.
- `server`: Bun HTTP server, sqlite storage, passkey auth, source adapters, and
  scan jobs.
- `client`: Quasar PWA and the browser-side audio pipeline.

## Development setup

Install Bun, then install dependencies from the repository root:

```bash
bun install
```

Run the default development stack:

```bash
bun run dev
```

The server listens on `http://localhost:3000` and the Quasar development server
listens on `http://localhost:9000`.

## Checks

Run all unit tests:

```bash
bun run test
```

Run the production build:

```bash
bun run build
```

Run the Playwright end-to-end suite:

```bash
bun run e2e
```

The e2e suite uses `e2e/jmmp.e2e.yml` and an isolated sqlite data directory under
`e2e/.e2e-data/`, which is ignored by git.

## Style

- Keep TypeScript explicit at module boundaries and reuse the existing shared
  types instead of duplicating API shapes.
- Prefer focused tests for server routes, source adapters, storage behavior, and
  client audio/state logic.
- Do not commit local config, runtime sqlite databases, generated Quasar output,
  compiled binaries, logs, or Playwright reports.

## License

By contributing, you agree that your contribution is licensed under the Apache
License, Version 2.0.
