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
| Puzzle quest | Image quest solved by assembling rectangular pieces; see [puzzle quests](#puzzle-quests) |
| Location quest | Quest solved when distinct teammates hold its places at once; typed answers are optional backup codes |
| Hint | Revealable help for one quest, with a points penalty |
| Team | Shared player identity belonging to a season, with its own quest order and progress |
| Admin | Game-master account allowed to author and control seasons |
| Game | A season while it is running |

## Data model

`seasons`, `teams`, `admins` and `phones` are the MongoDB collections. Nested arcs, quests and hints
stay inside the season document. References use stable string ids; MongoDB dates are `Date` values.
The zod schemas in `lib/domain/schemas.ts` validate data at write boundaries.

### seasons

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Season id; imported v3 seasons keep their v3 id |
| `title` | `string` | Season name |
| `lengthMinutes` | `number` | Configured game length |
| `defaultQuestPoints` | `number \| null` | Points copied into quests created with "+ Quest"; null means none |
| `placeRadius` | `number` | Whole-number radius from 5 to 500 metres copied into new places; absent reads as 40 |
| `mapArea` | `{lat: number, lng: number, zoom: number} \| null` | Initial map view for new places; absent reads as null |
| `start` | `Date \| null` | Scheduled or actual start; null before scheduling |
| `end` | `Date \| null` | Scheduled or actual end; adjusted by live controls |
| `shuffleArcs` | `boolean` | Shuffle arc order when building each team's order |
| `registrationOpen` | `boolean` | Teams may self-register for this season; a stored season without it counts as closed |
| `finisherBonuses` | `number[]` | Points by finish place; defaults to `[]` |
| `finishers` | `{teamId: string, place: number, points: number, at: Date}[]` | Claimed finishes; defaults to `[]` |
| `arcs` | `Arc[]` | Arcs in authored order |

A new season defaults to 60 minutes, no start or end, no arcs and shuffle off.
New seasons have no default quest points. A missing `defaultQuestPoints` reads as null; no migration is needed.

### Nested types

| Type | Fields |
| --- | --- |
| `Arc` | `id: string`, `title: string`, `shuffleQuests: boolean`, `quests: Quest[]` |
| `Quest` | `id: string`, `displayTitle: string`, `internalTitle: string`, `content: string`, `assetPath: string \| null`, `answers: string[]`, `points: number \| null`, `adminNotes: string`, `hints: Hint[]` |
| `Quest.location` | `{guidance: "none" \| "warmer" \| "map", places: Place[]} \| null`; absent reads as null; absent guidance reads as `"none"`; 1–3 places, with `"map"` required for 2 or 3 |
| `Place` | `id: string`, `lat: number`, `lng: number`, `radius: number` in metres |
| `Hint` | `id: string`, `text: string`, `points: number` |

A quest and each hint must have a stable id. Assign ids to hints that lack them.
`Quest` also has `hidden?: boolean`; absent means visible.
`Quest.puzzle` is `{rows: number, cols: number, showFull: boolean} | null`; absent reads as null.
Rows and columns are whole numbers from 2 to 7, defaulting to 4 each. `showFull` defaults to false.
Draft quests may have empty content, empty answers or missing points.
A regular quest is complete with content or an asset, at least one answer and points.
A puzzle quest is complete with an image and points; answers are optional.
A location quest is complete with content or a file, points and a place; answers are optional backup codes.
Display title is optional for every kind.
Whitespace-only text is empty; 0 points is set. `missingForGame` defines this shared rule.
Quest points are a whole number from 0 to 10000, or null on a draft.
"+ Quest" copies the season's default into the new quest's points. Without a default, points stay null and show "Needs points".
Changing the default never edits existing quests.
Copied quests and arcs keep their source points, regardless of the destination default.
The default is null or a whole number from 0 to 10000. Zero counts as set; it is editable in every season state.
There is no action to fill existing quests without points.
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
| `seasonId` | `string` | Assigned season |
| `questOrder` | `string[]` | Quest ids in this team's generated play order |
| `questIndex` | `number` | Index of the current quest in `questOrder` |
| `reachedAt` | `Date?` | When the team reached its current quest; set on order build and each advance, including skips |
| `score` | `number` | Accumulated points, allowed to be negative |
| `completed` | `boolean` | Team has finished its quest order |
| `progress` | `TeamQuestProgress[]` | Persistent history for each reached quest |

`TeamQuestProgress` is `{questId: string, solvedAt?: Date, hintsRevealed: RevealedHint[], pointsEarned: number}`.
Its optional `puzzle` field is `{version: number, spots: Spot[]}`, absent until the team reaches a puzzle quest.
`spots[i]` locates the piece whose correct cell is `i`.
`Spot` is `{cell: number}` in the frame, or `{x: number, y: number}` loose in the tray.
Tray coordinates range from 0 to 1 across the tray's free area.
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

### phones

Each record belongs to one team and one phone. The same phone can have separate records on different teams.

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Phone record id |
| `teamId` | `string` | Team id |
| `phoneId` | `string` | UUID from the existing phone cookie; never exposed in player data |
| `name` | `string` | Trimmed, NFC-normalized name, 1 to 20 characters |
| `lastSeenAt` | `Date` | Most recent presence update |
| `createdAt` | `Date` | First creation time |

Unique indexes cover `{teamId, phoneId}` and `{teamId, name}`; the name index uses case-insensitive
collation with strength 2. Initial names pair a random English adjective and animal, skipping taken names
and falling back to a numeric suffix. Saving an empty name generates a new random name.
Presence writes are skipped while `lastSeenAt` is under 60 seconds old. Deleting a team deletes its phones.
Development fixtures seed no phone records.

### admins and sessions

| Field | Type | Meaning |
| --- | --- | --- |
| `_id` | `string` | Admin id |
| `name` | `string` | Login name |
| `passwordHash` | `string` | bcrypt hash |

Use `bcryptjs` and iron-session 8. The cookie holds only `{kind: "admin" | "team", id: string}`.
Sessions last 30 days. Production requires `SESSION_SECRET`.
Each phone has a separate random UUID cookie, `the-game-phone`, lasting 400 days.
It is httpOnly, sameSite lax, secure in production and scoped to path `/`.
The phone id never enters the iron-session payload.
Team-session requests without a valid phone UUID get one in the proxy, forwarded on the same request
so the first page render sees it. Existing valid cookies are reused; admin and anonymous requests get none.
Phone names use this existing identity, never a second cookie or identity in the session.
`proxy.ts` denies by default.
Public paths are `/login`, `/logout`, `/register`, `/board`, `/api/events`, `/assets/`, `/_next/`, `/join/` and the icons.
`/api/events` authorizes its requested channels against the session itself.
Guard all server actions except public login, register and public `getBoard`.
Use `requireAdmin` or `requireTeam` for guarded actions.
The single login form tries admin then team in one request and returns one generic error on failure.
Team login matches names ignoring case, like the per-season unique index, and keeps teams whose password matches.
It picks the one in the registration-open season, else the latest season whose start has passed,
else an unscheduled or future-scheduled season.
A team whose season record is missing cannot use password-form login.
QR login still accepts a valid join token without checking the season record.
Admins land on `/admin`, teams on `/`. Deleting a team invalidates its sessions.
`/logout` accepts only POST, so a link or prefetch cannot log anyone out.
`pnpm admin:create <name>` prompts for a password. Production admins come from this CLI, not v3 users.

## Game rules

### Lifecycle and season lookup

Waiting, countdown, running, completed and ended are distinct player states.
Waiting means a missing season record or no start time; countdown means a future start.
At start, enter the game without reloading.
The game runs from `start` until `end`. At end, stop play and show the team's score.
When every quest in the team's order is finished, show completed with score.
Completed outranks ended and running, so a team that finished early stays completed after end.

A season counts until it ends: `end` is null or now is before `end`.
New teams join the counting season with `registrationOpen`, also while it runs, until it ends.
Only self-registration uses this lookup.
If no counting season has registration open, registration is not possible.
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

#### Finisher bonus

`finisherBonuses` contains whole numbers from 0 to 10000. Index 0 holds first place's points.
Every team completing its quest order claims the next finish place, even without a bonus row.
Places beyond the last row earn 0 points.
Correct answers and removal of a team's last quest both count as completion.
When one removal completes several teams, claim their places in `reachedAt` order, earliest first.
For older teams without `reachedAt`, use the last `solvedAt` in quest order, then season start.

Claim each place atomically on the season document. Teams finishing in the same second receive different places.
Record the team id, place, points and claim time in `finishers`.
Freeze the points at claim time and add them to `team.score` exactly once, including retries:

```text
score = score + bonus
```

Later row edits never change awarded points. Each team claims only once.
A row stays editable until its place is claimed. Claimed rows lock and show the winner.
Admins add rows at the bottom. They may remove only the last row, and only while unclaimed.
A row added after its place was claimed awards nothing. That place is already taken.
Deleting a team preserves its claimed place. Nobody moves up.
With no rows, scores stay unchanged. Finishes are still recorded, flagged and announced.

### Puzzle quests

Puzzle mode requires an image asset: jpg, png, webp, gif or svg.
GIF uses its first frame; SVG is rasterized. Pieces are rectangular and never rotate.
Answers remain optional. With answers, show the answer dock and let a correct typed answer solve as usual.
Without answers, hide the dock.

The first load of a reached puzzle quest writes a random spread, with every piece loose at a random tray spot.
Exactly one concurrent load writes it, like order builds.
A drop inside the frame snaps to the nearest cell, without revealing whether that cell is correct.
A filled cell swaps: its occupant moves to the dragged piece's previous spot.
A drop outside the frame stays loose where it lands.

Each drop conditionally writes against `puzzle.version`, retrying up to 3 times.
Concurrent drops never lose a write; the last drop of the same piece wins.
When every `spots[i]` equals `{cell: i}`, the same write path calls `solveCurrentQuest`.
Use the usual hint penalties, finisher claim and live events. Retries never double-award points or bonuses.

Puzzle mode, rows, columns, Replace and Remove lock once any team reaches the quest. `showFull` stays editable.
Reached means the team has a progress entry for the quest, or the quest is its current quest.
Removing an unreached puzzle quest's image also clears puzzle mode.
Reject replacement with a non-image while puzzle mode is on.
Quest copies include `puzzle` and share the image path, following the [copy rules](#authoring-and-live-edits).
Team puzzle state never copies.

### Location quests

`Quest.location` is `{guidance: "none" | "warmer" | "map", places: Place[]} | null`; absent reads as null.
New places start with `guidance: "none"`. Absent guidance and legacy data keep unguided behavior.
Each place is `{id: string, lat: number, lng: number, radius: number}`.
Locations have 1 to 3 places. Two or three places require `guidance: "map"`.
Puzzle and location exclude each other.
The server rejects setting either while the other is set.

`Season.placeRadius` is a whole number from 5 to 500 metres, default 40.
Absent reads as 40; no migration is needed. A new place copies the season's value.
Changing the season value never edits existing places.
Guidance, place count, coordinates and radius lock once any team has `solvedAt` on the quest.
Answers remain editable.

While a location quest is current and the game screen is open, each phone reports fixes as
`{lat, lng, accuracy, at}`, with `at` a Unix timestamp in milliseconds.
Accept accuracy of at most 50 metres. Reject fixes older than 30 seconds or more than 30 seconds in the future.
An accepted fix is inside when its haversine distance to the place is at most the place radius.
Exact accuracy, time and distance boundaries count as accepted and inside.
The server keeps each phone's latest accepted fix in memory, keyed by team and phone id.
Its age is `max(now - fix.at, now - receivedAt)`; it counts while its age is at most `fixTtlMs = 30_000`.
An old timestamp expires even when received recently; a future timestamp never extends the receipt lifetime.
Nothing is persisted.

A single place keeps the any-teammate-inside solve rule. With 2 or 3 places, each place must have a different
phone from the same team inside at once, using only fresh accepted fixes. Try every distinct-phone assignment,
choose the one holding the most places, and break ties in favor of lower place numbers. One phone inside
overlapping circles can hold only one. A typed backup code still solves without coverage.
Complete coverage solves through `solveCurrentQuest`, with the normal hint penalties, finisher claim and live events.
Reports never write team state except through that solve path. A solve, including a backup-code solve, clears
the team's latest fixes and warmer/colder history and pushes empty positions.
A multi-place report that does not complete coverage returns exactly `{status: "outside"}`.

Every map quest, including one with a single place, shows the same team's phone positions and names through
the [positions channel](#live-events). Pushes go out at most every `positionsPushMs = 5_000` per team.
Dots fade from `fadeStartMs = 20_000` until the 30-second lifetime ends. No position history is sent or stored.
Admins have no access to positions until #87. Reports publish the ordinary game-change channels only on a solve.

#### Warmer/colder guidance

Only `guidance: "warmer"` enables warmer/colder guidance. With fix-to-place distance `d` and radius `r`,
`d ≤ r` solves as usual. Outside, bands are `veryClose` when `d ≤ 3r`, `close` when `d ≤ 10r`,
and `far` beyond that. Boundaries are inclusive. Never send distance to players.

Far and Close include the initial great-circle bearing from the fix to the place, minus magnetic
declination at the fix. Use `magvar` with WMM2025, valid from 2025 up to 2030, evaluated at the fix timestamp.
Round the magnetic bearing to a whole number from 0 to 359, wrapping after rounding.
Very close omits the bearing and hides the arrow. Never show degrees.

Keep each phone's accepted fixes for the current quest in server memory for 60 seconds, keyed by team,
phone and quest. Compare the current distance with the mean distance of that phone's earlier accepted
fixes in the window. Mean minus current distance at least 25 metres gives `warmer`; at most −25 metres
gives `colder`; otherwise omit trend. No earlier fix means no trend. Nothing is persisted.
`guidanceWindowMs = 60_000` and `trendMinMeters = 25` in `lib/domain/location.ts` own tuning.
This history does not change `latestFixes` or its separate 30-second rule.

An outside report on a warmer quest returns:

```ts
{status: "outside", guidance: {band: "far" | "close" | "veryClose", bearing?: number, trend?: "warmer" | "colder"}}
```

An unguided or map quest's outside report returns exactly `{status: "outside"}`. Other statuses are unchanged.
Warmer/colder report guidance goes only to the reporting phone, never through `getGame`, previews or live events.
A rough or stale fix shows the existing "GPS too rough" state and clears band, arrow and trend.

Android Chrome reads magnetic heading from `deviceorientationabsolute` as `360 − alpha`.
iPhone reads `webkitCompassHeading` after `DeviceOrientationEvent.requestPermission()` from a tap.
Both use magnetic north; subtract `screen.orientation.angle` from the heading.
No usable reading within 2 seconds means no compass: retain band and trend, but show no arrow.
Listen only while the dock is live, guidance is `"warmer"` and the page is visible.
Compass access never blocks location reporting or solving. Previews never request permissions or report fixes.
Follow [Design](DESIGN.md) for presentation. `components/game/location-dock.tsx` owns dock status and helper copy,
`components/admin/place-field.tsx` owns the Place field. Existing off, rough, blocked, unavailable and found states
stay unchanged.

Coordinate paste accepts two decimal numbers separated by a comma and/or spaces, optionally with `°`.
Latitude ranges from −90 to 90 and longitude from −180 to 180; store both rounded to 6 decimals.
Invalid paste returns "Paste latitude, longitude, like 55.5079, 13.2353."

#### Map guidance and place editor

Only `guidance: "map"` exposes the place circles to players, following the
[player data boundary](#player-data-boundary). Arrival, accuracy and fix-age rules stay unchanged.
The player map frames the circle and the phone's own dot, refitting as fixes arrive until the player pans or zooms.
"Recenter" resumes framing. Keep north up and rotation off.
The dot uses the existing reporter's `watchPosition`, never a second watcher or `GeolocateControl`.
Rough fixes still show the dot and its accuracy ring. Send nothing new to the server.
Previews never request location permission or show an own dot.

The Place field shows an editor map for every guidance choice.
With a place, frame its circle with padding. Without one, use `Season.mapArea`; with neither, show no map.
Tapping the map adds a place only when the quest has none, using `newPlace` and the season radius.
Dragging the pin moves the place; dragging its edge handle resizes the radius.
Save once on release, writing the same whole `location` object through `saveSeasonField` as coordinate paste.
Round coordinates to 6 decimals and radius to whole metres, clamped from 5 to 500.
Guidance locks with the place. Locked maps remain visible but cannot edit it.

"◎ Use my position" starts a high-accuracy watch only on tap and accepts the first fix at most 50 metres accurate,
using `maxFixAccuracy`. While waiting, show "◎ Finding you… ±N m" and "Cancel".
Stop the watch on success, cancellation or after 30 seconds.
On timeout, show "Couldn't get within 50 m. Try outside."
On blocked permission, show "Location blocked. Allow it for this site, then try again."
Moving an existing place needs no confirmation and preserves its radius. Disable this action when locked.
Without a place or map area, offer "Set a map area in Settings ›" beside it.

Every map uses cooperative touch gestures: one finger scrolls the page, two move the map.
One finger still drags the pin and edge handle.
Use MapLibre GL with `https://tiles.openfreemap.org/planet` vector tiles and the committed navy style.
Show "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" once, expanded, on every map.
Load map code only through `next/dynamic` with `ssr: false`.
Players load it only for map quests; admins only when a Place field or Map area map renders.

#### Season map area and search

`Season.mapArea` is `{lat, lng, zoom} | null`; absent reads as null.
Latitude ranges from −90 to 90 and longitude from −180 to 180, rounded to 6 decimals.
Zoom ranges from 2 to 19, rounded to 2 decimals. Reject values outside those ranges before rounding.
Map area stays editable in every season state. Changing it never moves existing places.
Moving its map autosaves the resulting centre and zoom on `moveend` through ordinary field autosave.

Search runs on Search press only, never per keystroke. Trim queries and require 2 to 200 characters.
Call Nominatim server-side behind `requireAdmin`, with
`search?format=jsonv2&limit=5&accept-language=sv` and User-Agent `the-game-v4 (https://game.senth.org)`.
Allow at most one request per second and cache answers in memory for 24 hours.
Picking a result fits its bounding box at maximum zoom 17 and saves the map's resulting centre and zoom.
Show "Search © OpenStreetMap contributors" below results.
Follow [Design](DESIGN.md#maps) for map presentation, `components/admin/map-area-field.tsx` for the field
and the shared copy above for permission failures.

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
A new quest has empty display title, internal title and content, and no answers, hints or asset.
Its points follow the [default quest points rule](#nested-types).
The server sets points in `newQuest`; the client sends no points. The creation API stays unchanged.
`saveSeasonField` saves `defaultQuestPoints` with `requireAdmin` and the season live event.
It follows the field-save rules above.
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
Waiting, countdown and running game views include `teamName` and `phones: {name, you}[]`.
Only phones seen within 10 minutes appear, including the exact 10-minute edge.
Your phone comes first, then the rest by name. Phone entries expose no record id, phone id,
team id or timestamps. Admin previews have no calling phone, so no entry is `you`.
Completed and ended game views, standings, board and finishers expose no phone names.
A location quest adds `location` and `hasAnswers`, keeping `assetPath`.
For `"none"` and `"warmer"`, `location` is only `{guidance: "none" | "warmer"}`.
Their place coordinates and radius stay server-side, including in previews and live responses.
Only a `"map"` quest adds `location: {guidance: "map", places: [{lat, lng, radius}]}`.
Build every location response by whitelist. Place ids and distance never reach players.
Internal titles, admin notes, answers and unrevealed hint text remain excluded for every guidance choice.
Only the reporting phone's outside response on a warmer quest may include the report guidance object defined above.
Positions pushes carry only `{places: [{held}], phones: [{name, lat, lng, ageMs, place?}]}`.
Each `held` is a boolean; optional `place` is the 1-based place that phone holds in the same coverage assignment.
Only the team's own sessions receive these pushes. They contain no phone ids, place ids, team ids, timestamps
or history. Admins, including previews, have no positions access until #87.
The player finisher list exposes only team id, name, place and points, never claim times or other season fields.

A puzzle quest's player view omits `assetPath` and exposes this shape:

```ts
puzzle: {rows, cols, aspect, pieces: {id, spot}[], fullUrl: string | null}
```

Order `pieces` by piece id, never by correct index. Set `fullUrl` only when `showFull` is true.
Piece ids use the first 16 characters of this value:

```text
base64url(HMAC-SHA256(SESSION_SECRET, questId:assetPath:rowsxcols:index))
```

Ids stay stable per quest setup and reveal nothing about the correct index.

Team join URLs are absolute, built from the request's `host` and `x-forwarded-proto`.
They log teammates into that team's own `/`, never standings, board or admin JSON.

## Live events

Use an in-process event bus in one app container, with SSE rather than WebSockets.
Streams send a heartbeat every 25 seconds. Refetch on game-change events; positions events carry their payload
directly without refetching. Poll every 5 seconds only while disconnected, then switch back to SSE when connected.
Game-change updates from teammates and live controls should arrive within 1 second; positions pushes are limited
to once per 5 seconds per team.

| Channel | Triggers and readers |
| --- | --- |
| `team:<id>` | Correct solve, puzzle drop, finish, first hint reveal, team changes and structural edits; its sessions and admin preview |
| `positions:<teamId>` | Current map-quest fixes, coverage changes and expiry, at most every 5 s per team; only that team's sessions, never admins until #87 |
| `season:<id>` | Content, settings, timing, structure or teams change; solve, finish and reveal update admin stats and standings |
| `board` | Running-season changes, timing changes, solves, finishes, reveals and team changes; public TV standings |

A session whose team or admin no longer exists reads only `board`.

`getGame`, `submitAnswer`, `revealHint` and puzzle operations use authorized data.
Successful game mutations publish to all three channels after writes, except unsolved puzzle drops, which publish only `team:<id>`.
Puzzle solves publish all three channels. Wrong answers and repeated hint reveals are no-ops.
Location reports publish all three game-change channels only on a solve. Accepted map-quest fixes and expiry
also push the whitelisted positions payload while the season is running; other reports publish nothing.
Channel access must not expose another team's private data or admin-only content.

## Assets, migration and deployment

Assets live under `ASSETS_DIR` on a Docker volume and are served by a Next route handler at
`/assets/<uuid>.<ext>`. Accept any file up to 50 MB, where 1 MB is 1024 × 1024 bytes.
The server checks the first bytes, ignores the client MIME type and detects images
(jpg, png, gif, webp, svg), PDF, audio (mp3, m4a, ogg, wav) and video (mp4, webm).
Store JPEG files as `.jpg`. Unrecognized files keep their original lowercased extension
when it matches `^[a-z0-9]{1,10}$`, otherwise use `.bin`. Serve unrecognized bytes as
`application/octet-stream` with `Content-Disposition: attachment`, even with a known extension.
Serve SVG with `Content-Security-Policy: sandbox`. Reject path traversal. All assets have
`X-Content-Type-Options: nosniff` and `Cache-Control: public, max-age=31536000, immutable`.
Stream responses with `Accept-Ranges: bytes`; single byte ranges return 206 and
`Content-Range`, unsatisfiable ranges return 416.

Upload, replace and remove work before start and while live. Replace saves the new file before
deleting the old one. Remove, Replace, Remove quest and Remove arc delete a file only when no
quest in any season still references its path.

Puzzle tiles are cut on demand into a private cache, never served by `/assets/`.
Only the guarded puzzle route serves tiles. The original image stays in the assets folder under its random name.

v3 seasons were imported once in October 2026. v3 is archived and its backup is under `/mnt/lvm/backups/the-game-v3/`.

Production runs as the `the-game` service in server-infrastructure on fenrir,
with MongoDB 8 and persistent mongo and asset storage.
`game.senth.org` serves v4. Main merges auto-deploy the `:main` image within 5 minutes.
Build a non-root standalone app on `node:24-alpine`; gates run in PR CI.
Production admin creation runs inside the image through the bundled `scripts/admin-create.mjs` script.
MongoDB has no host port; the generic compose file binds the app to `127.0.0.1:5009` by default.
See [README.md](../README.md#deploying-with-compose) for environment variables, deployment commands and releases.
The human runs `terraform apply`. Agents may inspect the production compose project and run bundled commands under [AGENTS.md](../AGENTS.md).
Development and tests use `mongodb-memory-server`, never Docker.
I-33 decommissioned GCP, pointed v3's README to v4 and archived v3.

Work is tracked in one GitHub project, "The Game", using home-backlog labels plus `human` for work agents skip.
No milestones or area labels. GitHub blocked-by relations carry ordering. This phase files no issues.

## Backlog decisions deferred to their implementation

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
