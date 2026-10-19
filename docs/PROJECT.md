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
| `registrationOpen` | `boolean` | Teams may self-register for this season; a stored season without it counts as closed |
| `arcs` | `Arc[]` | Arcs in authored order |

A new season defaults to 60 minutes, no start or end, no arcs and shuffle off.

### Nested types

| Type | Fields |
| --- | --- |
| `Arc` | `id: string`, `title: string`, `shuffleQuests: boolean`, `quests: Quest[]` |
| `Quest` | `id: string`, `displayTitle: string`, `internalTitle: string`, `content: string`, `assetPath: string \| null`, `answers: string[]`, `points: number \| null`, `adminNotes: string`, `hints: Hint[]` |
| `Hint` | `id: string`, `text: string`, `points: number` |

A quest and each hint must have a stable id. Assign ids to hints that lack them, including on import.
`Quest` also has `hidden?: boolean`; absent means visible.
Draft quests may have empty content, empty answers or missing points.
A quest is complete with content or an asset, at least one answer and points. Display title is optional.
Whitespace-only text is empty; 0 points is set. `missingForGame` defines this shared rule.
Quest points are a whole number from 0 to 10000, or null on a draft.
Hint points are a whole number from 0 to 10000.
Answers are stored trimmed and NFC-normalized, 1 to 200 characters.
Sequential additions deduplicate by `normalizeAnswer`; concurrent near-duplicates are possible and harmless.
Warn in the tree and beside missing fields, following [missing-field warnings](DESIGN.md#missing-field-warnings).
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
Admins may add a team to a season at any time, regardless of `registrationOpen`.
Use the same name and password rules as [self-registration](#lifecycle-and-season-lookup).
Admins may set a new team password at any time, using the self-registration password rule.
Logged-in sessions stay valid. Old QR join links stop working because they sign the password hash.
A reset publishes `team:<id>` so waiting and countdown screens refetch their QR code.
Admins may delete a team at any time. Deletion publishes `team:<id>`, `season:<id>` and `board`.

### admins and sessions

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Admin id |
| `name` | `string` | Login name |
| `passwordHash` | `string` | bcrypt hash |

Use `bcryptjs` and iron-session 8. The cookie holds only `{kind: "admin" | "team", id: string}`.
Sessions last 30 days. Production requires `SESSION_SECRET`.
`proxy.ts` denies by default.
Public paths are `/login`, `/logout`, `/register`, `/board`, `/api/events`, `/assets/`, `/_next/`, `/join/` and the icons.
`/api/events` authorizes its requested channels against the session itself.
Guard all server actions except public login, register and public `getBoard`.
Use `requireAdmin` or `requireTeam` for guarded actions.
The single login form tries admin then team in one request and returns one generic error on failure.
Team login matches names ignoring case, like the per-season unique index, and keeps teams whose password matches.
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
The first game, standings or board load after start builds a team's empty order.
Exactly one concurrent load writes it.
"Start now" sets `start` 20 seconds from now and `end` to `start` plus `lengthMinutes`. It needs at least one quest.
Start now asks for confirmation when any quest is incomplete, including hidden drafts.
The server action does not block on incompleteness.
Complete seasons start in one click. Scheduling a future start shows no missing-field warning.
Admins may schedule a future start on Settings or clear it while upcoming.
A scheduled `end` always follows `start` plus `lengthMinutes`.
Length locks once the season is live. While live, −5 min needs more than 5 minutes left; +5 min always works.
"End game" sets `end` to now. On an ended season, +5 min sets `end` to now plus 5 minutes.
Two seasons' start-to-end windows may not overlap. Rejections name the other season.

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

Team hint loss sums the penalty points in every revealed-hint snapshot, including the current unsolved quest.
M3 and M4 both show this total. It can exceed penalties charged against score, since penalties charge only on solve.

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
Percentage labels round positive behind percentages up and absolute ahead percentages down.
Values rounded to zero read "On pace".
Outside running play, use the lifecycle state instead of dividing by a missing duration or an empty quest count.

### Standings strip

Standings rank teams by points. Equal points share a rank, so ranks run 1, 2, 2, 4.
Within a tie, the team whose latest solve came earliest goes first; teams without solves follow, by name.
Always include #1. If you are #1, including tied for #1, show only you.
Otherwise show #1, the team immediately ahead of you, and you, without duplicates.
Insert `···` between #1 and the team ahead only when other teams sit between them.
Rank is small and muted, name regular, points bold in heading color; tint your team.
The whole strip is the button to `/standings`.
If a season is running, use latest start; otherwise use latest ended season's final ranking or nothing.
Keep final ranking until another season starts; countdown seasons do not replace it.
Board rows show solved and todo only. Scope public TV board to `/board`; add no admin link.
`/standings` shows S1 while running, final standings when completed or ended; waiting and countdown redirect to `/`.
Teams completed during a running season get final view with "You solved every quest."; the all-team list stays live.
Other teams' rails show solved and todo only; only your row shows current, and only while running.

### Authoring and live edits

Every season field except `end` and `registrationOpen` autosaves on blur or after 500 ms idle.
`assetPath` changes only through I-17's upload actions, never field autosave.
`start` and `lengthMinutes` autosave through window checks. Window saves set `start` and `end` together.
`end` changes only through live controls.
A server action validates values before writing.
The `registrationOpen` field keeps its own action.
Lists never save whole. Additions and removals in `answers` and `hints` change one item at a time.
Before start, admins add, remove and move arcs and quests freely, including quests across arcs.
While live, admins may add and remove arcs and quests. Moves stay pre-start only.
Ended seasons reject every structural edit.
A move sends one id and its target, never the whole list, and never overwrites a concurrent field edit.
A new arc is titled "New arc" and copies `shuffleArcs` into `shuffleQuests`.
A new quest has empty display title, internal title and content, no answers, hints or asset, and `points: null`.
Removing an arc removes its quests.
A save publishes `season:<id>` and `board`. Open admin pages reload server data on `season:<id>`.
A field accepts a value from another tab only when it is unfocused and has no unsaved edit.
Otherwise, its local value stays and its next save wins.
Show "Saved", "Saving…" or "Not saved, retry". Failed saves keep the local value.
Retry, another edit to that field, or the browser coming back online resends it.
Preview renders real game components from the current edit, following unsaved changes before autosave completes.

Text, answers, hints and points apply immediately during play, including hint reordering.
Revealed-hint snapshots remain unchanged.
Quests added while live are hidden drafts.
Players, rails, standings, board, order builds and live stats skip hidden drafts.
"Add to game" clears `hidden` only when the quest meets the [completeness rule](#nested-types).
It then applies the new-quest rule below. Removing a hidden draft affects no team.

Adding a quest to the game and removals touching teams require confirmation naming the affected team count.
Read counts when the dialog opens; recompute impact from current team documents when writing.
Teams whose orders are not built yet are skipped and not counted. Their later build reads the current season.

Structural edits follow these rules:

- A new quest goes into a random position after the current quest in each team's remaining order.
  Completed teams ignore added quests.
- A deleted quest is removed from teams that have not reached it. Teams that already solved it are unchanged.
- Teams currently on a deleted quest skip it with 0 points. The quest leaves `questOrder`, `questIndex` stays,
  and its progress entry records `pointsEarned: 0` without `solvedAt`, keeping revealed hint snapshots.
  Score is unchanged. If no quest remains at `questIndex`, the team is completed.
- Removing an arc applies the delete rule to each quest. Count each team once.

Structural edits publish `team:<id>` for each changed team, plus `season:<id>` and `board`.

Admins copy an arc, or one quest, from a season in any state into another season that hasn't started.
Unstarted means `start` is null or in the future. The write re-checks this; rejection names the started destination.
The source season is never a destination. Copying only reads it; editing either copy or source never changes the other.
Copies get new arc, quest and hint ids. Every quest and hint field is copied, plus the arc's title and `shuffleQuests`.
Copies drop `hidden`, so a live draft becomes an ordinary quest. Missing-field warnings flag anything incomplete.
Images are shared by path, following the [asset reference check](#assets-migration-and-deployment).
A copied arc goes last in the destination. A copied quest goes last in its chosen arc.
A quest may go into a new arc that takes the source arc's title and `shuffleQuests`.
Matching arc titles are allowed and never renamed.
Team progress, stats and revealers never copy. A copy publishes `season:<destination id>` only.

Admin live quest stats show completion and revealers only while running; hide before start and after end.
N counts teams that solved the quest. M counts teams whose order includes it, or whose order is not built yet.
Hint-editor "Revealed by" chips are hidden until the season has started.
Team views retain per-quest revealed hints and earnings after solving.

## Player data boundary

Players never receive internal titles, admin notes, answers or unrevealed hint text, including in previews
and live responses. Hidden hints may expose their id, position and penalty, not their text.
Players reveal hints by id, not by index, so edits and deletions cannot shift a reveal onto another hint.
Construct a player view without deleting fields from the shared season object.

Team join URLs are absolute, built from the request's `host` and `x-forwarded-proto`.
They log teammates into that team's own `/`, never standings, board or admin JSON.

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
`/assets/<uuid>.<ext>`. Allow jpg, png, gif, webp and pdf up to 10 MB. The server checks a file's
first bytes, ignores the client MIME type and sets the extension from the detected type. Store
JPEG files with the `.jpg` extension. Reject path traversal; serve immutable assets with
`Cache-Control: public, max-age=31536000, immutable`.

Upload, replace and remove work before start and while live. Replace saves the new file before
deleting the old one. Remove, Replace, Remove quest and Remove arc delete a file only when no
quest in any season still references its path.

`pnpm import:v3 <export.json>` imports seasons and reusable quests, not teams or users.
Use `--dry-run` to inspect counts, skips and warnings without fetching assets or writing data.
Set `MONGODB_URI`; real imports also require `ASSETS_DIR` for downloaded assets.
Export Firestore seasons with
`pnpm export:v3 --project <gcp-id> [--collection game_seasons] --out <file>`; credentials use Application Default
Credentials or `GOOGLE_APPLICATION_CREDENTIALS`.
The human exports production Firestore data as JSON, not Firestore's binary backup format:
`{ "<collection>": { "<docId>": season } }`. The collection name may have any prefix.
Exactly one top-level collection is required; zero or several is an error.
Ignore `__collections__` metadata keys wherever present.

`lib/domain/v3-import.ts` maps this JSON without network, filesystem or database access.
Each result contains a validated v4 `season`, `assetJobs` keyed by its new quest ids, and `warnings`.
Inputs stay unchanged. Mapping rules:

- Use the source document id as season `_id` so repeated imports do not duplicate seasons.
  Keep the season title; always set `registrationOpen: false`. Missing `length` becomes 60 minutes.
- Keep `start` and `end`. Accept ISO timestamps, `{ "_seconds": 1704067200 }`,
  `{ "seconds": 1704067200 }`, and
  `{ "__datatype__": "timestamp", "value": { "_seconds": 1704067200 } }`.
  Missing dates become null. With a start but no end, derive end as start plus length in minutes.
- `Random All` and `Random Theme` set `shuffleArcs: true`.
  `Ordered` and `Random Quest` set it false. Preserve authored array order.
- Each theme becomes an arc with a new UUID, its original title and `shuffleQuests` from `random`.
  Every quest and retained hint gets a new UUID, including quests copied between v3 seasons with identical ids.
- Quest `title` becomes `internalTitle`, `description` becomes `adminNotes`, and `displayTitle` stays as is.
  Missing quest text fields become empty strings. Missing answers and hints become empty arrays.
- Split `answer` on `|`, trim and NFC-normalize each part, drop empty parts and deduplicate by `normalizeAnswer`.
  Keep the first spelling. Drop answers longer than 200 characters with a warning.
- Quest points must be a whole number from 0 to 10000; otherwise set them to null with a warning.
- Nonempty `code` with nonempty `content` becomes a Markdown fenced block whose language is `code`'s value.
  Use at least three backticks and a fence longer than every backtick run inside the content.
  Other content stays raw trusted HTML. Do not add a fence when content is absent.
- Drop hints whose text is missing, empty or whitespace-only. Preserve remaining text.
  Clamp out-of-range hint points to 0-10000 with a warning.
- A nonempty `asset` queues `{ url: asset, target: "assetPath" }`.
  With no asset, a nonempty `imageUrl` queues the same job using its URL.
  With both, also queue `{ url: imageUrl, target: "content" }` and warn that it will append a Markdown image.
  `assetPath` stays null until the jobs run; content-append jobs leave content unchanged until then.
  The downloader saves old asset URLs into `ASSETS_DIR` before applying their local paths.
- Every warning names the season title and source id, arc and quest.
  Validate every mapped season with `lib/domain/schemas.ts`; reject malformed input or any remaining schema violation,
  including invalid lengths, invalid timestamps and non-whole hint points within range.

Production runs compose with app and MongoDB 8 on fenrir, persistent mongo and asset volumes, and GHCR images
published on `v*` tags. Build a non-root standalone app on `node:24-alpine`; gates run in PR CI.
Production admin creation and v3 imports run inside the image through bundled scripts,
`scripts/admin-create.mjs` and `scripts/import-v3.mjs`.
MongoDB has no host port; compose binds the app to `127.0.0.1:5009` by default.
See [README.md](../README.md#deploying-with-compose) for environment variables, deployment commands and releases.
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
