# Tests

## Unit and database tests

Vitest tests `lib/domain/` as pure functions without a database. Cover every rule in
[PROJECT.md](PROJECT.md), especially shuffle flags, answer matching, scoring, player-data stripping,
pace boundaries, standings selection and live structural edits. Test shuffle distribution over 10,000 runs.
Assert input objects stay unchanged and player JSON contains neither answers nor hidden hint text.
Cover [puzzle rules](PROJECT.md#puzzle-quests): dimensions, defaults, completeness, snapping,
occupied-cell swaps, loose drops and solved detection.
Check deterministic preview spreads and stable piece ids.
Assert player pieces expose no correct-index order or original asset path.
Test optimistic drops and rollback, snap targets, the full-picture dialog, completion hold,
answer-dock visibility and inert previews in component tests.
Test the editor's no-image helper, mode toggle, range errors, locked controls and optional-answers helper.

Vitest tests `lib/db/` against MongoDB 8 through `mongodb-memory-server`, never a live database or Docker.
Give each test file a fresh database. Cover create/get/list, per-path `$set`, the per-season name index,
persistent hint history, guards and structural-edit writes. Concurrent field edits must preserve both values.
Test concurrent finisher place claims for unique places and exactly-once score awards.
Test that later bonus-row edits never change claimed points or awarded scores.
Test that one quest removal completing several teams claims places in arrival order.
Use [PROJECT.md's finisher rules](PROJECT.md#finisher-bonus) for ordering and scoring expectations.
Cover concurrent puzzle initialization, version conflicts, retries, same-piece drops, lock counting
and exactly-once puzzle solves with finisher claims.
Test puzzle copying without team state, guarded tile access, private caching and asset release cleanup.

Cover hidden-draft exclusion from player data, rails, standings, board, order builds and live stats.
Cover removal-dialog impact outcomes: current teams skip with zero points, unreached quests leave orders,
and solved teams keep their points.
Assert unbuilt orders are skipped and not counted, and arc removal counts each team once.

Put reproducible rule and interaction cases in unit or component tests rather than adding browser flows.
Write a red regression test first for a reproducible bug. On failure, rerun only affected tests while fixing.

### Points drop

Use [PROJECT.md's points-drop rules](PROJECT.md#points-drop) for time worth and countdowns.
Schemas accept absent, null and valid drops, default absence to null, and reject non-integer or
out-of-range full minutes, drop minutes and floors, including exact range boundaries.
Pure tests cover before, at and after full time, mid-drop rounding, exact full-plus-drop time,
after the drop, floors equal to or above points, null points, a zero floor and unchanged inputs.
Countdown tests cover the first deduction at 11:20 for 20p with 10 full minutes, 20 drop minutes
and a 5p floor, every later step, and no next deduction at the floor.
Test hint penalties after time worth, negative displayed worth, and the 0p solve minimum with
and without a drop. Null drops preserve otherwise unchanged scoring.
Keep all-hints worth unclamped. Test arrival fallback without `reachedAt`: last `solvedAt` in
quest order, then season start. Add no browser flow.

### Location quests

Use [PROJECT.md's location rules](PROJECT.md#location-quests) for expected behavior and exact boundaries.
Pure tests cover coordinate parsing, rounding, invalid pastes, geographic ranges and haversine distance.
Cover closed circle rings, the east-facing edge point at the radius, rounded handle distances and both 5/500 clamps.
Test antimeridian-safe bounds and Nominatim bounding-box conversion without mutating inputs.
Check legacy `mapArea` reads as null, coordinate and zoom rounding, and rejection outside latitude, longitude and zoom ranges.
Test accuracy, age, future-time and radius boundaries on both sides, including equality.
Cover completeness without answers, missing places, legacy defaults and unchanged inputs.
Cover 1-, 2- and 3-place distinct-phone coverage, incomplete coverage and overlapping circles where one phone
reaches several places. Check a valid full assignment is found even when the first phone can hold every place.
Test deterministic maximum coverage, ties favoring lower place numbers, inclusive radius edges and unchanged inputs.
Schemas accept 1–3 places, reject 0 and 4, and require map guidance for 2 or 3, including absent legacy guidance.
Test guidance bands on both sides of and at `r`, `3r` and `10r`; inside still solves without guidance.
Cover initial great-circle cardinal bearings, north wraparound and date-line crossing.
Verify WMM2025 declination at the fix (Svedala is about 5.5° east in October 2026), subtraction and integer wrapping.
Test trend against the earlier-fix mean, empty history, both sides of and at ±25 metres, and unchanged inputs.
Test the 60-second history window, pruning, quest/team/phone isolation and exclusion of the current fix from its mean.
Keep the 30-second latest-fix lifetime separate from guidance history.

Test reports against isolated MongoDB, including malformed fixes and wrong, hidden, removed or non-location quests.
Reject reports outside running play, after completion and from another team.
Test concurrent phones, retries and races with hint reveals and place edits.
Assert exactly one solve, score award and finisher claim, using stored hint penalties.
Assert only solves publish ordinary game-change channels; accepted fixes also publish throttled admin live-positions events.
Rejected and outside reports leave team state unchanged.
Test backup answers and authorized solved-location earnings for teammate completion feedback.

Test latest-fix replacement, team/phone isolation and expiry on reads and writes, including future-dated fixes.
Check `fixAgeMs` uses the older of the fix timestamp and server receipt: 30 000 ms counts, 30 001 ms expires,
and an old `at` expires despite a fresh `receivedAt`. Keep the 5-second push and 20-second fade constants explicit.
Test separate UUID phone cookies across shared-login phones, stable reuse, malformed-cookie replacement
and required cookie attributes.
Assert the phone id never enters the session payload.
Test report authorization and admin guards before reads or writes.
Cover place locks, editable backup answers, puzzle exclusion and concurrent edits.
Assert radius changes leave existing places unchanged.
Test guarded copies retaining place configuration without team progress.
Whitelist player, preview, live and report responses against
[PROJECT.md's player data boundary](PROJECT.md#player-data-boundary).
None and warmer quests reject coordinates, radius and places alongside existing secrets.
Map quests expose exactly `location: {guidance: "map", places: [{lat, lng, radius}]}` in player and preview views.
Reject place ids, distance, answers, internal titles, admin notes and hidden hint text for every guidance choice.
Assert projection leaves inputs unchanged and does not share mutable place objects.
Whitelist outside guidance to band, optional bearing and optional trend, only for the reporting phone.
Assert unguided and map outside reports remain exactly `{status: "outside"}`; other statuses stay unchanged.
Very close omits bearing. Rough and stale fixes clear band, arrow and trend.
Assert warmer/colder report guidance never enters `getGame`, previews or live events.
Player location exposes only its guidance setting unless map guidance permits the circle whitelist above.

Component tests cover every dock status, helper copy, accuracy, permission actions, backup-code visibility and inert previews.
Test completion hold and teammate refetch feedback.
Mock geolocation, permissions, visibility, fetch and wake locks. Never request real positions.
Mock `deviceorientationabsolute`, `webkitCompassHeading`, motion permission and screen orientation; never use live sensors.
Cover magnetic heading conversion, screen-angle subtraction, north wrap and the 2-second no-reading timeout.
Test iPhone's tap-only permission request, refusal, no-compass fallback and listener cleanup when hidden or inactive.
Cover band, trend and arrow states, including Very close, before first guidance and inert previews.
Cover granted, prompt, denied and missing APIs, reporting cadence, hidden-tab pauses, resume and cleanup on quest changes.
Assert stale callbacks and responses cannot restart reporting; release late wake locks and tolerate wake-lock failures.
Test the Place field's empty state, valid and invalid paste, radius edits, lock copy and disabled controls.
Mock MapLibre in component tests. Cover pin and edge-handle drags, one save on release, tap-only creation,
cooperative gestures, framing, own-dot accuracy rings and Recenter after manual pan or zoom.
Verify the own dot reuses the reporter's watcher and previews never watch or ask permission.
Mock geolocation for Use my position: tap-only start, first fix at most 50 metres accurate, rough-fix feedback,
cancellation, 30-second timeout, blocked permission, cleanup, preserved radius and locked controls.
Mock Nominatim fetch for admin guards, trimmed query bounds, Swedish results, submit-only search,
one-request-per-second throttling, 24-hour caching, empty/error states and bounding-box selection autosave.
Use no live tiles or geocoding in unit, component or browser tests.
Cover puzzle exclusion, optional answers, draft previews, header autosave and retry.
Test New place radius helpers and range errors.
Keep these cases in unit and component tests. Add no browser flows.

### Game master live map

Use [PROJECT.md's live-map rules](PROJECT.md#game-master-live-map) for payloads, expiry, throttling and colors.
Store tests cover multi-team reads, team isolation, copied fixes and exact 30-second expiry boundaries.
Check `expiresInMs` against both fix timestamps and server receipt times, including future phone clocks.
Isolated MongoDB tests join nicknames by team and phone, excluding orphan fixes and teams outside the season.
Assert all season teams appear name-sorted, even without phones; whitelist teams, map area, phones and places
with exact payload equality. Places appear even before phones report. Reject phone UUIDs, timestamps, place ids,
quest ids, answers and team secrets from JSON.
Pure place tests cover 1- and 3-place current quests, all three guidance choices and shared quest places with
both teams' ids in name order. Check grouping by quest and place, first-appearance then place-number order,
current-only selection and unchanged inputs. Skip non-location, completed, hidden, removed and unbuilt-order teams.
Player-boundary tests keep other teams' places and current quests out of game views and positions pushes.
Before start, after end and without start, return exactly `{live: false}`.
Action tests reject anonymous and team sessions before database or store reads; admins receive the payload.
Channel and events-route tests restrict `live-positions:<seasonId>` to admins.
Reject teams, deleted sessions, anonymous sessions and malformed names.
Keep `positions:<teamId>` access unchanged: owning team only, never another team, anonymous sessions or admins.
Report tests cover accepted inside and outside fixes, rejected fixes, stop reports and unchanged solve channels.
Fake timers prove leading publication, one-second per-season throttling and the final trailing update.
Check season isolation and timer cleanup.
Assert reports write no position history and leave MongoDB collections unchanged unless they solve.
Pure tests cover distinct, evenly spaced hues for 2, 10 and 20 teams, lightness alternation above ten and stable output.
Add no browser flow; existing core-loop smoke test remains unchanged.

### Phone names and storage

Pure tests cover trimmed and NFC-normalized names, the 1/20-character boundaries, invalid lengths,
case-insensitive comparison, random names skipping taken names and numeric suffixes after word-pair exhaustion.
Database tests cover distinct phones on one team, the same phone on separate teams, stable repeated creation,
case-insensitive duplicate rejection, concurrent random-name and same-identity races, empty-name regeneration,
60-second presence write throttling, scoped removal and the admin team-delete cascade.
Seed tests assert no seeded phones and that a database containing only phones is not empty.
Proxy tests cover missing, valid and malformed UUID cookies, required attributes, same-request forwarding,
unchanged session payloads and no phone cookie for admin or anonymous sessions.
Keep the existing location-route cookie tests unchanged.

## End-to-end budget

Playwright global setup boots `mongodb-memory-server`, supplies `MONGODB_URI`, starts the app,
and global teardown stops both. Run headless, without Docker, production data or manual browser driving.
Keep the I-28 core-loop smoke test under 60 seconds locally and in CI.
Only e2e setup sets `E2E_START_COUNTDOWN_MS` to override the 20-second start countdown.

The core flow is one connected scenario:

1. Admin logs in and creates a season, an arc, two quests with hints, and a team.
2. Admin starts the game.
3. Team reveals a hint, submits a wrong answer, then answers both quests correctly.
4. Team sees completed; admin team view shows the hint penalty and retained reveal history.

`pnpm e2e` runs after `pnpm build` in every implementation phase and needs its standalone output.
That gate run is also the UI self-test; do not run the suite again merely for a final green tree.
Keep detailed lifecycle, hold cancellation, autosave and ordering cases in unit or component tests when possible.

## Development fixture

`pnpm seed` drops the database and reloads "Cipher Night 2026".
It targets `MONGODB_URI`, else the MongoDB port in this checkout's live `.tmp/dev-stack/stack.json`,
else a temporary mongod on a freshly allocated port with dbPath `.tmp/mongo`.
It refuses `NODE_ENV=production` and hosts other than `localhost` or `127.0.0.1` unless passed `--force`.
`pnpm dev` allocates its web and MongoDB ports from 7000-7999 in the registry shared with other checkouts.
When `MONGODB_URI` is unset, it boots `mongodb-memory-server` on its MongoDB port with dbPath `.tmp/mongo`.
Dev login cookies ignore the port, so two worktrees in one browser log each other out.
It seeds only an empty database, then starts `next dev`.
Seed accounts are `admin / admin` and `Ninjas / ninjas`. Other teams use their lowercased name as password.
Never deploy those passwords. The seed copies the Backwards log image to `ASSETS_DIR`, default `.tmp/assets`.
Start and end follow seed time, so the season is running with registration open and Ninjas is mid-game.
Backwards log has `drop: { fullMinutes: 10, dropMinutes: 20, floor: 5 }`; Ninjas' `reachedAt` is seed time minus 15 minutes.
Cipher Night has `finisherBonuses: [50, 20]` and no finishers.
"Gather the pieces" uses a 4 × 4 puzzle, no answers and `showFull: false`, keeping its points and hints.
Commit a landscape PNG under 300 KB in `scripts/fixture/`, such as a drawn keeper's chart.
Seed copies it to `ASSETS_DIR`.
Mock photos are placeholders, not fixture content.
Rävarna is already on it, with eight pieces in cells, including two in wrong cells; the remaining pieces are loose.
Old Town includes "Next stop", a 20-point warmer/colder location quest at Svedala station, with a 40 m radius,
one 5-point hint and no answer or file. It ends with "Three corners", a 25-point map location quest with three
35–40 m places around Svedala centre and no answers. Its content is "The old town was laid out from three stones.
Stand on all three at once and the town will tell you where to go next." followed by "Split up. Each circle needs
one of you inside it."
Every team has both location quests unsolved, so quest orders total 14; scores, ranks and solved counts stay unchanged.
Byggarna and Team Kaos start on "Three corners", and Lagom starts on "Next stop". Team Kaos replaces Rävarna
because Rävarna is already in Finale.
Fixture tests validate puzzle and location configuration plus progress against the zod schemas.

| Arc | Quests | Authored order |
| --- | --- | --- |
| Lighthouse | 4 | Backwards log; Fog horn morse; Keeper's ledger; Lamp room |
| Old Town | 7 | Church bells; Cobblestones; Baker's riddle; Clock tower; Harbour map; Next stop; Three corners |
| Finale | 3 | Gather the pieces; The vault; Last word |

Lighthouse and Old Town shuffle quests; Finale is ordered. Team quest orders differ from authored order.
The names and representative standings come from S1:

| Rank | Team | Solved out of 14 | Score |
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

Ninjas is currently on Backwards log, with Next stop next, Three corners after and three behind pace. Backwards log
has display title "The keeper's last log" and answers `["lighthouse", "fyren"]`. Give it content,
an asset and hints at 5, 10 and 20 points, with the first revealed.
Retain revealed hints on solved quests too, so M1 completion/revealer chips and M4 history have real records.
Lagom has a removed, skipped quest with one 5-point hint snapshot and no earned points.
Its solved Backwards log has a deleted-hint snapshot, already charged against that quest's 15 earned points.
Lagom stays at 70 points, with the same standings order. Ninjas is unchanged.
Fixture scores and progress must be internally consistent with PROJECT.md; mock numbers are illustrative,
not separate scoring rules. M3 and M4 use different illustrative hint-loss totals.

Use isolated test variants for a missing season record, upcoming/countdown, ended, completed, no revealers
and incomplete drafts.
Do not report intentionally hidden hints or unplayed quests as missing seed data.

## Application gates

Run in the configured order:

| Gate | Proves |
| --- | --- |
| `pnpm lint --write` | markdownlint, then Biome formatting and lint checks with `preset: "recommended"` |
| `pnpm typecheck` | Strict TypeScript with `tsc --noEmit` |
| `pnpm test` | Pure rules, database writes and regression/component tests |
| `pnpm build` | Next.js standalone production build |
| `pnpm e2e` | Real admin-to-player core loop against an isolated database; runs after and needs `pnpm build` output |
