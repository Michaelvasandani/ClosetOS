# 01 — Project scaffold

Status: ready-for-agent
Type: task

Set up the TypeScript project so everything else has a home. No product logic.

## Do

- `package.json` (ESM, Node 20+), `tsconfig.json` (strict).
- Test runner: **Vitest**. Lint/format: **Biome** (or ESLint+Prettier if preferred — pick one, note it).
- `bin/closet` entrypoint wired to `src/cli`.
- Create empty dirs with `.gitkeep`: `wardrobe/`, `outfits/wears/`, `preferences/`.
- `src/core/` and `src/cli/` folders. A `dev` script (`tsx`/`ts-node`) so `closet` runs without a build.
- `.gitignore` (node_modules, dist, `.env`).
- CLI arg parsing library chosen (e.g. `commander` or `citty`) — thin, note the choice.

## Done when

`npm install` succeeds, `npm test` runs (0 tests OK), `./bin/closet --help` prints usage.

## Notes

Keep `src/core/` free of any CLI/arg-parser dependency (ADR-0002 — core is a reusable library; CLI is a thin shell).
