# Agent rules

## Stack and scope

The Game is a timed puzzle hunt. Players share a team login; game masters author and run seasons.
Use Next.js 16 App Router, React 19, strict TypeScript, Tailwind CSS 4 and Node 24 LTS.
Use pnpm, Biome, Vitest and Playwright. MongoDB 8 uses the official `mongodb` driver and zod schemas,
not Mongoose. Authentication uses iron-session 8 and `bcryptjs`.

MongoDB access lives in `lib/db/`, zod schemas in `lib/domain/`, and dev boot and seeding in `scripts/`.

## Commands and proof

| Command | Purpose |
| --- | --- |
| `pnpm dev` | Boot local MongoDB, seed if empty, then run Next.js development server |
| `pnpm seed` | Load the development fixture documented in `docs/TESTS.md` |
| `pnpm lint --write` | Run markdownlint, then Biome, and apply supported Biome fixes |
| `pnpm typecheck` | Run `tsc --noEmit` |
| `pnpm test` | Run Vitest domain and database tests |
| `pnpm build` | Build the standalone Next.js application |
| `pnpm e2e` | Run the headless core-loop smoke test once I-28 adds it |

Run configured gates in order.

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

<!-- markdownlint-disable MD013 MD025 -->
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
<!-- markdownlint-enable MD013 MD025 -->
