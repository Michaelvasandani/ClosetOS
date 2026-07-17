# ClosetOS

A daily-use wardrobe assistant. See `closetos_project_and_infrastructure.md` for the full
vision, `CONTEXT.md` for the domain glossary, and `docs/adr/` for architecture decisions.

## Development

Requires Node.js 20+.

```bash
npm install        # install dependencies
./bin/closet --help   # run the CLI (no build step — runs TypeScript via tsx)
npm run dev -- --help # same, via the dev script
npm test           # run the test suite (Vitest)
npm run typecheck  # tsc --noEmit
npm run lint       # Biome check
npm run format     # Biome format --write
```

`bin/closet` is a thin launcher that runs `src/cli/index.ts` directly through `tsx`, so there is
no build step in v1.

## Tooling choices

These are the "pick one, note it" decisions from the scaffold (issue 01):

- **Language/runtime**: TypeScript on Node 20+, ESM (`"type": "module"`). Shared by the CLI now
  and a future Lambda/WhatsApp shell later (ADR-0002).
- **Test runner**: [Vitest](https://vitest.dev) — fast, ESM-native, minimal config.
- **Lint + format**: [Biome](https://biomejs.dev) — one tool for both, chosen over ESLint+Prettier
  to avoid maintaining two configs.
- **CLI arg parsing**: [commander](https://github.com/tj/commander.js) — thin, ubiquitous, and its
  subcommand model maps cleanly onto the v1 command surface (`add`, `list`, `outfit`, …).
- **No-build dev path**: [tsx](https://github.com/privatenumber/tsx) runs the TypeScript entrypoint
  directly, so `closet` works without a compile step.

## Architecture

The CLI (`src/cli/`) is a thin shell over a reusable core library (`src/core/`) that owns all
reasoning and data access and carries **no** CLI/arg-parser dependency (ADR-0002).
