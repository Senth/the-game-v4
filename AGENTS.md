# Agent rules

## Stack and scope

The Game is a timed puzzle hunt. Players share a team login; game masters author and run seasons.
Use Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4 and Node 24 LTS.
Use pnpm, Biome, Vitest and Playwright. MongoDB 8 uses the official `mongodb` driver and zod schemas,
not Mongoose. Authentication uses iron-session 8 and `bcryptjs`.

This bootstrap contains documentation and accepted mocks, not application code.
I-01 adds the application scripts and `app/globals.css`; I-02 adds database boot and seed support.
Do not scaffold those as part of documentation work.

## Commands and proof

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Boot local MongoDB, seed if empty, then run Next.js development server |
| `pnpm seed` | Load the development fixture documented in `docs/TESTS.md` |
| `pnpm lint --write` | Run Biome and apply supported fixes |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm test` | Run Vitest domain and database tests |
| `pnpm build` | Build the standalone Next.js application |
| `pnpm e2e` | Run the headless core-loop smoke test once I-28 adds it |

Run configured gates in order. For this docs-only bootstrap, proof is
`npx markdownlint-cli2 "**/*.md"`, a Python `tomllib` parse of `.ai/config.toml`, and an HTTP fetch
of the preview iframe from `docs/mocks/D1-admin-desktop.html`.
Ignore `node_modules` when linting Markdown.

Agents never run Docker on fenrir. Its `docker` command invokes `sudo docker` and needs a password.
Development and tests use `mongodb-memory-server`; production images build in CI and the human runs compose.
When `MONGODB_URI` is unset, `pnpm dev` persists the local database under `.tmp/mongo`.
Keep temporary artifacts under `.tmp/`. Do not use live databases or services in tests.

## Folder layout

| Path | Owns |
| --- | --- |
| `app/` | Routes, server actions, route handlers and global Tailwind tokens |
| `components/` | Shared player and admin UI, including real player previews |
| `lib/domain/` | zod schemas and pure game rules |
| `lib/db/` | MongoDB client, indexes and repository operations |
| `lib/auth/` | Sessions, password hashing and server-side guards |
| `lib/events/` | Single-container event bus and live update support |
| `scripts/` | Development boot, seed, admin creation and v3 import CLIs |
| `docs/mocks/` | Nine accepted HTML and PNG mock pairs |

## Contracts

- [Project](docs/PROJECT.md) owns domain rules, pace math, standings selection and migration decisions.
- [Tests](docs/TESTS.md) owns fixtures, test responsibilities and the e2e budget.
- [Design](docs/DESIGN.md) owns the dark visual language, tokens and accepted surface briefs.
- [Personas](docs/PERSONAS.md) describes players and game masters.
- [Mocks](docs/mocks/README.md) records accepted references and superseded details.
- `.ai/config.toml` owns application gates and review boot instructions.

Keep rules in their owning document and link to them elsewhere. Conform to the accepted design.
Guard admin routes and every admin server action. Player responses must omit secrets as defined in PROJECT.md.
