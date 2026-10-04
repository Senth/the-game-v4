# Tests

## Bootstrap proof

Before application scaffolding, run `npx markdownlint-cli2 "**/*.md"` with the copied v3 rules.
The CLI configuration excludes `node_modules` and `.tmp`. It treats the exact one-line `@AGENTS.md`
include as front matter so CLAUDE.md remains a pointer rather than a separate rules document.
Parse `.ai/config.toml` with Python 3 `tomllib`. Serve `docs/mocks/` over local HTTP and fetch
`D1-admin-desktop.html`, then its relative iframe source `G2-game.html`.
These checks prove documentation style, config syntax and the preview path, not application behavior.

## Unit and database tests

Vitest tests `lib/domain/` as pure functions without a database. Cover every rule in
[PROJECT.md](PROJECT.md), especially shuffle flags, answer matching, scoring, player-data stripping,
pace boundaries, standings selection and live structural edits. Test shuffle distribution over 10,000 runs.
Assert input objects stay unchanged and player JSON contains neither answers nor hidden hint text.

Vitest tests `lib/db/` against MongoDB 8 through `mongodb-memory-server`, never a live database or Docker.
Give each test file a fresh database. Cover create/get/list, per-path `$set`, the per-season name index,
persistent hint history, guards and structural-edit writes. Concurrent field edits must preserve both values.
The later first-finisher bonus needs an atomic concurrent-winner test.

Put reproducible rule and interaction cases in unit or component tests rather than adding browser flows.
Write a red regression test first for a reproducible bug. On failure, rerun only affected tests while fixing.

## End-to-end budget

Playwright global setup boots `mongodb-memory-server`, supplies `MONGODB_URI`, starts the app,
and global teardown stops both. Run headless, without Docker, production data or manual browser driving.
Keep the I-28 core-loop smoke test under 60 seconds locally and in CI.

The core flow is one connected scenario:

1. Admin logs in and creates a season, an arc, two quests with hints, and a team.
2. Admin starts the game.
3. Team reveals a hint, submits a wrong answer, then answers both quests correctly.
4. Team sees completed; admin team view shows the hint penalty and retained reveal history.

I-28 appends `pnpm e2e` to `.ai/config.toml` gates. Once present, it runs in every implementation phase.
That gate run is also the UI self-test; do not run the suite again merely for a final green tree.
Keep detailed lifecycle, hold cancellation, autosave and ordering cases in unit or component tests when possible.

## Development fixture

`pnpm seed` loads "Cipher Night 2026". When `MONGODB_URI` is unset, `pnpm dev` boots
`mongodb-memory-server` with persisted dbPath `.tmp/mongo`, seeds only if empty, then starts `next dev`.
Development seed accounts are `admin / admin` and `Ninjas / ninjas`; never deploy those passwords.
Initialize start/end relative to seed time so the fixture is running and Ninjas is mid-game.

| Arc | Quests | Authored order |
| --- | --- | --- |
| Lighthouse | 4 | Backwards log; Fog horn morse; Keeper's ledger; Lamp room |
| Old Town | 5 | Church bells; Cobblestones; Baker's riddle; Clock tower; Harbour map |
| Finale | 3 | Gather the pieces; The vault; Last word |

Lighthouse and Old Town shuffle quests; Finale is ordered. Team quest orders differ from authored order.
The names and representative standings come from S1:

| Rank | Team | Solved out of 12 | Score |
| --- | --- | --- | --- |
| 1 | Rävarna | 9 | 120 |
| 2 | Team Kaos | 8 | 105 |
| 3 | Fjällräv | 8 | 98 |
| 4 | Byggarna | 7 | 90 |
| 5 | Glada Gänget | 7 | 82 |
| 6 | Lagom | 6 | 70 |
| 7 | Ninjas | 5 | 64 |
| 8 | Kodknäckarna | 4 | 50 |
| 9 | Sista Laget | 4 | 41 |
| 10 | Lösenord123 | 2 | 20 |

Ninjas is currently on Backwards log, with display title "The keeper's last log" and answers
`["lighthouse", "fyren"]`. Give it content, an asset and hints at 5, 10 and 20 points, with the first revealed.
Retain revealed hints on solved quests too, so M1 completion/revealer chips and M4 history have real records.
Fixture scores and progress must be internally consistent with PROJECT.md; mock numbers are illustrative,
not separate scoring rules. M3 and M4 use different illustrative hint-loss totals.

Use isolated test variants for no season, upcoming/countdown, ended, completed, no revealers and incomplete drafts.
Do not report intentionally hidden hints or unplayed quests as missing seed data.

## Application gates

These become runnable after I-01 scaffolds application scripts. Run in the configured order:

| Gate | Proves |
| --- | --- |
| `pnpm lint --write` | Biome formatting and lint checks |
| `pnpm typecheck` | Strict TypeScript with `tsc --noEmit` |
| `pnpm test` | Pure rules, database writes and regression/component tests |
| `pnpm build` | Next.js standalone production build |
| `pnpm e2e`, added in I-28 | Real admin-to-player core loop against an isolated database |
