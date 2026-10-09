# Project

## Product and implementation

The Game is a timed puzzle hunt played by teams sharing a login across phones.
Game masters author reusable quests, run seasons and fix content during play.
v4 keeps v3 parity and its TODO backlog, except voice chat is research only in I-35.

Use Next.js 16 App Router, React 19, strict TypeScript, Tailwind 4 and Node 24 LTS.
Use pnpm, Biome, `tsc --noEmit`, Vitest and Playwright. MongoDB 8 uses the official
`mongodb` driver with zod schemas, not Mongoose. [Design](DESIGN.md) owns appearance;
[tests](TESTS.md) owns proof and fixtures.

## Glossary

| Term | Meaning |
| --- | --- |
| Season | Scheduled collection of arcs with a start, end and game settings |
| Arc | Authored group of quests, called a theme in v3 |
| Quest | Puzzle with player content, accepted answers, points and hints |
| Hint | Revealable help for one quest, with a points penalty |
| Team | Shared player identity belonging to a season, with its own quest order and progress |
| Admin | Game-master account allowed to author and control seasons |
| Game | A season while it is running |

## Data model

`seasons`, `teams` and `admins` are the MongoDB collections. Nested arcs, quests and hints
stay inside the season document. References use stable string ids; MongoDB dates are `Date` values.
The zod schemas in `lib/domain/schemas.ts` validate data at write boundaries.

### seasons

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Season id; v3 import uses its source id for repeatable imports |
| `title` | `string` | Season name |
| `lengthMinutes` | `number` | Configured game length |
| `start` | `Date \| null` | Scheduled or actual start; null before scheduling |
| `end` | `Date \| null` | Scheduled or actual end; adjusted by live controls |
| `shuffleArcs` | `boolean` | Shuffle arc order when building each team's order |
| `registrationOpen` | `boolean` | New teams join this season; a stored season without it counts as closed |
| `arcs` | `Arc[]` | Arcs in authored order |

### Nested types

| Type | Fields |
| --- | --- |
| `Arc` | `id: string`, `title: string`, `shuffleQuests: boolean`, `quests: Quest[]` |
| `Quest` | `id: string`, `displayTitle: string`, `internalTitle: string`, `content: string`, `assetPath: string \| null`, `answers: string[]`, `points: number \| null`, `adminNotes: string`, `hints: Hint[]` |
| `Hint` | `id: string`, `text: string`, `points: number` |

A quest and each hint must have a stable id. Assign ids to hints that lack them, including on import.
Draft quests may have empty content, empty answers or missing points.
Warn in the tree and beside missing fields; starting an incomplete season warns the admin.
Content is Markdown with trusted, admin-authored raw HTML. Use `react-markdown` with `rehype-raw`
and Shiki for fenced code. There is no separate v3 `code` field.

### teams

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Team id, not its name |
| `name` | `string` | Name unique within a season, ignoring case |
| `passwordHash` | `string` | bcrypt hash, never plaintext |
| `seasonId` | `string \| null` | Assigned season; null until active-season lookup assigns one |
| `questOrder` | `string[]` | Quest ids in this team's generated play order |
| `questIndex` | `number` | Index of the current quest in `questOrder` |
| `score` | `number` | Accumulated points, allowed to be negative |
| `completed` | `boolean` | Team has finished its quest order |
| `progress` | `TeamQuestProgress[]` | Persistent history for each reached quest |

`TeamQuestProgress` is `{questId: string, solvedAt?: Date, hintsRevealed: RevealedHint[], pointsEarned: number}`.
`RevealedHint` is `{hintId: string, text: string, points: number, revealedAt: Date}`.
Each reveal stores the hint's stable id, text and penalty at reveal time, plus its reveal timestamp.
History survives advancement to the next quest. Deleting or editing a hint never rewrites these snapshots.
Reordering hints preserves their ids and snapshots. Deleted hints remain in the team's history and score.
Create a unique index on `teams` for `{seasonId, name}` and a `{name}` index for login.
The per-season unique index uses case-insensitive collation (strength 2).
Admin creation and self-registration both remain.

### admins and sessions

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Admin id |
| `name` | `string` | Login name |
| `passwordHash` | `string` | bcrypt hash |

Use `bcryptjs` and iron-session 8. The cookie holds only `{kind: "admin" | "team", id: string}`.
Sessions last 30 days. Production requires `SESSION_SECRET`.
`proxy.ts` denies by default.
Public paths are `/login`, `/logout`, `/register`, `/board`, `/api/events`, `/assets/`, `/_next/` and the icons.
`/api/events` authorizes its requested channels against the session itself.
Guard every server action except the public login and register actions with `requireAdmin` or `requireTeam`.
The single login form tries admin then team in one request and returns one generic error on failure.
Team login keeps the teams whose name and password match.
It picks the one in the registration-open season, else the latest season whose start has passed,
else an unscheduled or future-scheduled season, else no season.
Admins land on `/admin`, teams on `/`. Deleting a team invalidates its sessions.
`/logout` accepts only POST, so a link or prefetch cannot log anyone out.
`pnpm admin:create <name>` prompts for a password. Production admins come from this CLI, not v3 users.

## Game rules

### Lifecycle and season lookup

Waiting, countdown, running, completed and ended are distinct player states.
Waiting means no season or no start time; countdown means a future start.
At start, enter the game without reloading.
The game runs from `start` until `end`. At end, stop play and show the team's score.
When every quest in the team's order is finished, show completed with score.
Completed outranks ended and running, so a team that finished early stays completed after end.

A season counts until it ends: `end` is null or now is before `end`.
New teams join the counting season with `registrationOpen`, also while it runs, until it ends.
Self-registration and a team without a season use this lookup. If no counting season has registration open,
registration is not possible and a seasonless team sees waiting.
At most one counting season may have registration open. Opening it while another counting season has it
is rejected with an error naming that season; the flag never moves automatically.
Opening registration on an ended season is rejected. Ended seasons keep their flag, but it no longer counts.
Changing `end` so a flagged ended season counts again is rejected the same way while another counting season has it.
Names may repeat in different seasons, not within one season.
Self-registration trims names, accepts 1 to 30 characters and needs a password of at least 4.
A team registering before start gets an empty order. Live Start builds it (#14).
Live Start sets start and end. The admin can shift end by minus or plus 5 minutes, or confirm End game.

### Quest order and rail

For each team, copy arcs in authored order. If `season.shuffleArcs` is true, shuffle them with Fisher-Yates.
For each arc, copy its quests and shuffle with Fisher-Yates only if `arc.shuffleQuests` is true.
Flatten the resulting groups to `questOrder`; never mutate the season to generate an order.
New arcs default their shuffle setting to the season's setting.

The rail always uses authored order, not the team's shuffled order. It has one segment per quest,
with a wider gap between arcs. Solved quests are green at their authored positions; current quest is blue.
Do not show "quest N of M" beside the rail.

### Answers, hints and score

Normalize submitted and accepted answers to Unicode NFC, trim them and compare case-insensitively.
Any member of `answers: string[]` may match.
Reject submissions over 200 characters as invalid before comparing.
A wrong answer changes no game state. A correct answer records `solvedAt`, earns points and advances the team.
Every logged-in session of that team receives the update.

A player holds a locked hint row for 2 seconds to reveal it. Releasing early cancels.
Append a `RevealedHint` snapshot to that quest's `progress.hintsRevealed` on first reveal.
Match repeated reveals by `hintId`; revealing it again is a no-op. Do not reset history on solve.
Hint penalties are charged on solve, not on reveal:

```text
pointsEarned = quest.points - sum(points in progress.hintsRevealed snapshots)
score = score + pointsEarned
```

Neither quest earnings nor team score has a floor. Intel shows current worth and full quest worth.
Past `pointsEarned` records preserve what the team earned; live quest-point edits affect subsequent solves.
Hint edits affect only future reveals. Solves use the stored penalties, even if the hints were edited or deleted.

### Pace

This is the sole definition used by the header, standings and admin views.
For a running season with a positive duration and at least one quest:

```text
timeFraction = clamp((now - start) / (end - start), 0, 1)
solvedFraction = solved / total
timePercent = 100 * timeFraction
solvedPercent = 100 * solvedFraction
behindPercent = timePercent - solvedPercent
N = round(timeFraction * total) - solved
```

| Band | Condition | Token |
| --- | --- | --- |
| On pace or ahead | `behindPercent <= 0` | `pace-ok` |
| Slightly behind | `0 < behindPercent <= 10` | `pace-1` |
| Behind | `10 < behindPercent <= 20` | `pace-2` |
| Far behind | `behindPercent > 20` | `pace-3` |

Header text is "N behind" for positive N, "N ahead" for negative N using its absolute value,
or "On pace" for zero. Color comes from the percentage band, not rounded N.
Outside running play, use the lifecycle state instead of dividing by a missing duration or an empty quest count.

### Standings strip

Standings rank teams by points. Equal points share a rank, so ranks run 1, 2, 2, 4.
Within a tie, the team whose latest solve came earliest goes first; teams without solves follow, by name.
Always include #1. If you are #1, including tied for #1, show only you.
Otherwise show #1, the team immediately ahead of you, and you, without duplicates.
Insert `···` between #1 and the team ahead only when other teams sit between them.
Rank is small and muted, name regular, points bold in heading color; tint your team.
The whole strip is the button to `/standings`. `/board` is public for a TV and shows only a running season.

### Authoring and live edits

Autosave each field on blur or after 500 ms idle using server actions that `$set` one validated path.
Show "Saved", "Saving…" or "Not saved, retry". Edits to different fields from different tabs must not overwrite
one another. Retry retains unsaved local values. Preview renders real game components from the current edit.

Text, answers, hints and points apply immediately during play, except revealed-hint snapshots remain unchanged.
Structural edits require confirmation that names how many teams are affected:

- A new quest goes into a random position after the current quest in each team's remaining order.
  Completed teams ignore added quests.
- A deleted quest is removed from teams that have not reached it. Teams that already solved it are unchanged.
- Teams currently on a deleted quest skip it with 0 points. The quest leaves `questOrder`, `questIndex` stays,
  and its progress entry records `pointsEarned: 0` without `solvedAt`, keeping revealed hint snapshots.
  Score is unchanged. If no quest remains at `questIndex`, the team is completed.

Reordering hints, quests across arcs, or whole arcs uses the same live-edit rules.
Copying an arc into an unstarted season creates independent quests with new ids.
Admin live quest stats show completion and revealers only while running; hide before start and after end.
Hint-editor "Revealed by" chips are hidden until the season has started.
Team views retain per-quest revealed hints and earnings after solving.

## Player data boundary

Players never receive internal titles, admin notes, answers or unrevealed hint text, including in previews
and live responses. Hidden hints may expose their id, position and penalty, not their text.
Players reveal hints by id, not by index, so edits and deletions cannot shift a reveal onto another hint.
Construct a player view without deleting fields from the shared season object.

## Live events

Use an in-process event bus in one app container, with SSE rather than WebSockets.
Streams send a heartbeat every 25 seconds. Refetch on events; poll every 5 seconds only while disconnected,
then switch back to SSE when connected. UI updates from teammates and live controls should arrive within 1 second.

| Channel | Triggers and readers |
| --- | --- |
| `team:<id>` | Correct solve, first hint reveal, team changes and structural edits affecting the team; its sessions and admin preview |
| `season:<id>` | Content, settings, timing, structure or teams change; solve and reveal update admin stats and standings |
| `board` | Running-season changes, timing changes, solves, reveals and team changes; public TV standings |

`getGame`, `submitAnswer` and `revealHint` use authorized data. Successful game mutations publish to all
three channels after writes. Wrong answers and repeated hint reveals are no-ops.
Channel access must not expose another team's private data or admin-only content.

## Assets, migration and deployment

Assets live under `ASSETS_DIR` on a Docker volume and are served by a Next route handler at
`/assets/<uuid>.<ext>`. Allow jpg, jpeg, png, gif, webp and pdf up to 10 MB.
Remove deletes the file. Reject path traversal; serve immutable assets with
`Cache-Control: public, max-age=31536000, immutable`.

`pnpm import:v3 <export.json>` imports seasons and reusable quests, not teams or users.
Map themes to arcs, `answer "a|b"` to `["a", "b"]`, and `code` plus `content` to fenced Markdown.
Keep trusted HTML. Map v3 `Random All` and `Random Theme` to `shuffleArcs: true` and retain each theme's
`random` flag as `shuffleQuests`. Download old asset URLs into `ASSETS_DIR`.
Use source season ids so repeated imports do not duplicate seasons. The human exports production Firestore data.

Production runs compose with app and MongoDB 8 on fenrir, persistent mongo and asset volumes, and GHCR images
published on `v*` tags. Build a non-root standalone app on `node:24-alpine`; gates run in PR CI.
The human handles DNS, nginx at `game.senth.org`, SSE proxy settings, compose and production seed/import.
Agents never run Docker because fenrir requires sudo. Development and tests use `mongodb-memory-server`.
After the first real v4 game, the human decommissions GCP, points v3's README to v4 and archives v3.

Work is tracked in one GitHub project, "The Game", using home-backlog labels plus `human` for work agents skip.
No milestones or area labels. GitHub blocked-by relations carry ordering. This phase files no issues.

## Backlog decisions deferred to their implementation

- I-30 defines a per-season first-finisher bonus, default `5 × number of teams`, with one atomic winner.
  It is not part of the base solve formula until that issue adds the rule and fields here.
- I-34 adds default quest points per season, affecting new quests only, not existing ones.
- I-35 researches LiveKit versus peer-to-peer WebRTC for 2-6 players on phones. No voice implementation.

## Do not reintroduce v3 bugs

- Plaintext password storage or comparison.
- Two racing `res.json` calls from one login request.
- Hint penalty iteration with `i <= hints.length` instead of a valid array bound.
- Biased shuffling with `sort(() => Math.random() - 0.5)`.
- Mutating a shared season when constructing the current quest's player view.
- Game polling every 250 ms or stats polling every 1 second.
- Whole team documents in session cookies.
- Globally unique team names used as document ids.
- Losing revealed-hint history when the team advances.
