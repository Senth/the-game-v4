# Project

The Game is a timed puzzle hunt. Teams share a login across phones.
Game masters author quests and run seasons.
Rules live in code and tests. This file holds only what they can't show.

## Glossary

- Season: scheduled arcs with a start, end and settings. A game is a running season.
- Arc: authored group of quests. v3 called it a theme.
- Quest: content, accepted answers, points and hints. Puzzle and location quests exclude each other.
- Team: shared login in one season, with its own quest order and progress.
- Admin: game master account.

## Where rules live

| Rules | Code |
| --- | --- |
| Schemas and defaults | `lib/domain/schemas.ts` |
| Lifecycle, order, pace, standings | `lib/domain/game.ts` |
| Scoring and points drop | `lib/domain/scoring.ts` |
| Finishers | `lib/domain/finishers.ts`, `lib/db/finishers.ts` |
| Puzzles | `lib/domain/puzzle.ts` |
| Location and guidance | `lib/domain/location.ts`, `lib/game/positions.ts` |
| Player views | `lib/domain/player-game.ts` |
| Live channels | `lib/events/channels.ts` |
| Structural edits and copies | `lib/db/seasons.ts`, `lib/db/structural-writes.ts` |
| Assets | `lib/domain/assets.ts`, `lib/assets/` |

## Never break

- Players never receive internal titles, admin notes, answers or unrevealed hint text, including in previews.
- Build player views by whitelist. Never delete fields from the shared season.
- Players get place coordinates only on map quests. Distance, place ids and phone ids never reach them.
- The session cookie holds only `{kind, id}`. The phone id has its own cookie.
- Positions pushes reach only the team's own sessions. `live-positions` reaches only admins.
- Location fixes stay in memory and are never persisted.
- Every solve uses `solveCurrentQuest`, awarding score once and a finisher place only on completion, even on retries.
- Hint penalties charge on solve from snapshots taken at reveal. Hint edits never rewrite history.
- Quest earnings floor at 0. Team score has no floor.
- Awarded finisher points freeze. A deleted team keeps its place.

## Operations

- Run one app container. The event bus is in-process, so a second replica breaks live updates.
- Rotating `SESSION_SECRET` breaks puzzle piece ids and QR join links.
- Serve SVG sandboxed. Sniff upload bytes and ignore the client MIME type.
- Delete an asset file only when no quest in any season references it.
- Deployment and environment variables live in [README](../README.md).
