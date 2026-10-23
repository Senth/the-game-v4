# Design

## Character and authority

The Game keeps v3's dark navy palette and Roboto family. It is a puzzle hunt, not a dashboard.
Quest content gets the player's attention; admin tools stay dense enough to run a game from a phone.
Conform to the nine accepted mocks in [mocks/README.md](mocks/README.md), subject to the corrections there.
Login, registration, seasons list, lifecycle states and the TV board have no separate mocks.
They use this same language, not a new visual direction.

`app/globals.css` owns the runtime token values.
[PROJECT.md](PROJECT.md) alone defines pace math, rail meaning, standings-strip selection and game rules.

## Tokens

| Tailwind token | Approved value | Allowed use |
| --- | --- | --- |
| `z0` | `#05080d` | Page background and quiet header |
| `z1` | `#131f41` | Raised strips, answer dock and recessed tracks |
| `z2` | `#2d476b` | Separators, neutral chips and lifted drag rows |
| `field` | `#0e121f` | Inputs and textareas |
| `ink` | `#c5c7d8` | Body copy and ordinary names |
| `muted` | `#8a90a8` | Labels, rank, helper copy and secondary values |
| `link` | `#8c9eff` | Navigation, secondary actions and reveal affordances |
| `head` | `#bbdefb` | Headings and emphasized points |
| `accent` | `#1c7dc8` | Primary action, current quest, focus and own-team tint |
| `warn` | `#ffa500` | Wrong answers, hint penalties and missing-field warnings |
| `pace-ok` | `#4ade80` | On-pace/ahead state, solved segments and correct-answer feedback |
| `pace-1` | `#e8c547` | First behind band |
| `pace-2` | `#ff8c1a` | Second behind band |
| `pace-3` | `#b3261e` | Last behind band and destructive-control border |
| `time` | `#0d47a1` | Elapsed-time bar, not quest completion |

Declare colors as `--color-<token>` in `@theme`. The mock-only aliases `ok`, `you`, `team` and
`accent-strong` are not additional application tokens. Use `pace-ok` for success and `accent` for your team.
The old neon success green `#00ff00` is replaced by `pace-ok`.

| Font token | Family | Use |
| --- | --- | --- |
| `--font-head` | Roboto | Headings |
| `--font-body` | Roboto Slab | Quest prose and ordinary body text |
| `--font-cond` | Roboto Condensed | Labels, numbers and buttons |

Load fonts with `next/font`. Numbers use tabular figures so clocks, points and aligned columns do not shift.
Code fences use Shiki; the authoring textarea can use the platform monospace font.

## Layout and interaction rules

- Dark only. No theme switch and no light variants.
- Use one accent for the primary action; secondary actions use quiet link text or a neutral outline.
- Pair pace colors with text. Never ask color alone to explain the team's position.
- Touch targets are at least 44 px. A compact visible label may have a larger target.
- Separate regions by background shift or border, never both for the same boundary.
- Keep the player mobile-first at 390 px, without horizontal scrolling.
- Admin has full authoring and live-control capability on phone, not a read-only companion mode.
- At widths of at least 1024 px, use D1's desktop frame; below that, use the mobile frame.
- Use the existing Tailwind spacing, type and radius utilities from the accepted mocks.
  Phone gutters use `px-4`, field stacks `space-y-5`, and fields/buttons `rounded-md`.
  Do not introduce one-off values for ordinary spacing or controls.
- Drag rows have no handles. A 400 ms long press with mouse or touch lifts the row.
  A short tap opens or edits; normal scrolling must not start a drag.
- Hint, quest and arc rows rest as text. Enter editing on tap so a long press never begins inside an input.
- Drag state uses H1's lifted row and dashed slot. Use `@dnd-kit` with delayed `PointerSensor`
  and custom `KeyboardSensor` rather than another drag implementation.
  Untouched rows turn `muted`; only the lifted row and slot have emphasis.
  On Android, vibrate for 10 ms on lift where supported.
  A failed move uses the header's "Not saved, retry". The row stays where it was dropped.
- Keyboard reordering uses Alt+↑/↓ for the focused row and Alt+Shift+↑/↓ for a quest's neighboring arc.
  Alt+↑/↓ stops at the list edge.
  Alt+Shift+↑ puts the quest last in the previous arc; Alt+Shift+↓ puts it first in the next arc.
- Honor `prefers-reduced-motion`. A hint still requires its full hold, but its fill does not animate.
- Autosave state belongs in the header, not a Save bar. Use the exact states defined in PROJECT.md.
  Show it only on pages with an autosave field. Place it at the phone header's right edge.
  On desktop, place it in the top bar, left of live controls.
  Render "Saved" and "Saving…" as `font-cond text-xs text-muted`.
  On failure, turn the header's bottom rule `warn`; give the failed field a `warn` border and a "Not saved" line.
  Use a "Not saved, retry" button with a 44 px target.
- Mark internal titles and admin notes "admin only". Keep them out of real player previews.

## Component ownership

`app/globals.css` owns runtime tokens. `app/` owns routing and page composition.
`components/` owns shared game content, rail, Intel, answer dock and the admin list/editor views.
Extend those shared implementations rather than copying layouts into routes.
Desktop reuses the mobile quests, teams and team-history components in its middle pane.
Desktop phone frame and mobile Edit/Preview render the real player components, not a second rendering system.
With a team open, the desktop preview follows [M4's team preview rules](#m4-admin-team-history).

### Quest preview

The quest preview header shows the season clock and authored-order rail, with the previewed quest current.
It shows no pace or standings strip. The clock uses `text-muted` without a team.
While running, the clock shows time left. Before start, including unscheduled seasons, it shows the full `lengthMinutes`.
After end, it shows `0:00`.
Hints stay locked and inert. The answer dock remains visible, with its input and Send disabled.
Lifecycle screens never appear in the quest preview.
On phone, Edit/Preview stays sticky under the quest header, with 44 px buttons.
Opening another quest resets the toggle to Edit.

## G2: player game

Mock: [HTML](mocks/G2-game.html), [PNG](mocks/G2-game.png).

Surface brief: job is solving the current quest with teammates; primary action "Send";
read first the quest content, second the time left and pace, third the Intel worth;
must not look like a dashboard; remove "quest N of M", quiet the standings strip, sharpen the answer dock.

Use G2's header, with the shorter "2 behind" wording rather than the mock's "2 quests behind pace".
Timer color follows PROJECT.md. Keep the arc rail and standings strip subordinate to quest content.
The strip itself opens standings; rank is muted, names regular, points bold, and your team tinted.

Quest content has an optional display title, image or asset, and Markdown with highlighted fences.
Omit the title heading when its trimmed text is empty.
Intel shows current/full worth, revealed hints with right-aligned penalties, and locked hold-to-reveal rows.
The fixed answer dock contains only the input and Send. It remains visible at every scroll position.
Wrong-answer feedback is an orange line fading over 4 seconds; correct feedback uses success green.

The quest asset sits where the image sits and follows final mock F
([phone](https://artifacts.senth.org/f-final-phone-4f838f.png),
[desktop](https://artifacts.senth.org/f-final-desktop-a8bb05.png)):

- Image and SVG show the image.
- PDF shows the "Open PDF" link.
- Audio shows a bar with a 44 px accent play button, a seekable track and `0:12 / 0:42` time.
- Video shows a native player at the image's size.
- Any other file shows a full-width bordered `↓ Download <EXT>` button, or "Download file" for `.bin`.
- The team preview keeps all of these inert.

### Puzzle board

Final mocks:

- Frame and tray, G: [phone](https://artifacts.senth.org/g-frame-tray-phone-f7a7f5.png),
  [desktop](https://artifacts.senth.org/g-frame-tray-desktop-1b227a.png).
- Full-picture thumbnail, B: [phone](https://artifacts.senth.org/b-thumbnail-phone-b3b4af.png).
  Keep only its thumbnail row.
- Completion, E: [phone](https://artifacts.senth.org/e-solved-phone-15ec47.png). Apply to G's frame; the tray stays empty.

Surface brief: job is rebuilding the picture with teammates on a phone;
primary action is dragging a piece into the frame.
Read first the frame and placed pieces, second loose tray pieces, third quest text and Intel.
Must not look like swap buttons, a dashboard, or a game with scores, timers or move counters.
Follow [PROJECT.md's puzzle rules](PROJECT.md#puzzle-quests) for answer-dock visibility and drop behavior.
Quiet the tray and cell lines; sharpen the lifted piece and dashed target cell.

- Replace the File slot above quest text with one play area: frame above tray, separated by `gap-2`.
- Frame uses `border-4 border-z2 bg-field rounded-md`, an inset shadow, faint `border-z1` cell lines
  and the image aspect ratio.
- Tray uses `bg-z1/50 rounded-md` and matches the frame's height.
  Pieces are cell-sized and axis-aligned, with a small drop shadow.
- Below, use `font-cond text-xs text-muted`: "Drag pieces into the frame. They snap to the nearest spot."
- When the full picture is available, show a 96 px thumbnail above the board with `text-link` "Full picture ›".
- Tapping opens a native `<dialog>` containing the full image, title "Full picture" and quiet "Close".
- On desktop, scale the play area to fit frame and tray within the viewport height below the header.
- Keep the answer dock reachable when present.

Use pointer events with `touch-action: none` on the play area only. Outside it, the page still scrolls. Support mouse too.
Lifting adds an accent ring, slight scale and large shadow.
Inside the frame, show the target cell with a dashed accent outline and `bg-accent/15`.
Apply drops locally immediately, then call `dropPuzzlePiece`. Live refetches reconcile; failed writes snap back.
There is no keyboard path for moving pieces.

On solve, close gaps and add `ring-2 ring-pace-ok`, with `pace-ok` copy `Puzzle complete · +<N>p`.
Hold for 1.5 seconds, then show the next quest.
Phones learning of a solve through refetch call `getSolvedPuzzle` and show the same completion state.
With `prefers-reduced-motion`, omit scale and slide animations.
Quest and team previews render the real board, inert.
Quest previews use a deterministic spread; team previews show the team's live board.
`components/game/puzzle-board.tsx` owns this board, composed by the shared quest content and preview components.

### Team menu and invite

Final mocks: [phone](https://artifacts.senth.org/final-kebab-team-heading-phone-01c18b.png),
[desktop](https://artifacts.senth.org/final-kebab-team-heading-desktop-e21ea2.png).

Surface brief: job is getting a late teammate in within seconds; primary action is showing the QR code;
read first the QR code, second "Copy link", third "Close";
must not compete with quest content or the answer dock, look like an app settings menu, or use emoji;
remove the Show/Hide toggle from the dialog, quiet the ⋮ and team heading, sharpen the QR.

Show the team menu only while running. Waiting and countdown keep their inline QR.

- A ⋮ button sits at the header's right edge, after the pace label, with a 44 px target.
- The ⋮ is `text-link` at rest and `text-head` while open.
  It is the header's only addition and stays quieter than clock and pace.
- The popover opens right-aligned under the button, in `bg-z1 rounded-md`.
- It starts with the team name as a muted uppercase heading. The heading is not focusable.
- Rows are text only, `min-h-11 font-cond text-sm text-ink`.
- The only row is "Invite a teammate". Future rows, such as Log out, go below it.
- A button tap, Escape, an outside tap or choosing a row closes the menu.

"Invite a teammate" opens the existing native `<dialog>` style:

- Title "Invite a teammate", then the QR, then "Teammates scan this to log in."
- Then an outline "Copy link" and a quiet "Close".
- The QR is the dialog's largest and lightest element. There is no "Hide QR code" toggle.
- Escape and a backdrop tap close the dialog.

## S1: player standings

Mock: [HTML](mocks/S1-standings.html), [PNG](mocks/S1-standings.png).

Surface brief: job is answering "how far have we come vs how much time is left, and where do we stand";
primary action is back to the quest; read first your two bars, second your rank, third the other teams;
must not look like a spreadsheet.

Use separate time and quests bars. Put the time tick on the quests bar and a textual percentage pace label nearby.
The time bar uses `time`; the quests bar uses the team's pace color.
Rows show rank, name, solved/total, points and authored-order rail. Your row is tinted.
Ten teams fit without horizontal scrolling at 390 px; updates arrive live.
Final view puts team label and sentence first, points at right, then place and solved/total, as `7th of 10 · 5 / 12 quests`.
Completed during a running season uses final view with "You solved every quest."; the all-team list stays live.
`‹ Quest` returns to quest while running; completed and ended use `‹ Back`.

## D1: desktop admin

Mock: [HTML](mocks/D1-admin-desktop.html), [PNG](mocks/D1-admin-desktop.png).

Season-tree surface brief: job is seeing the whole season and jumping to a quest;
primary action is opening a quest; read first arc names, second quest titles, third points;
must not show drag handles or per-row buttons.

Quest-editor surface brief: job is writing or fixing a quest quickly, often on a phone mid-game;
primary action is editing the content; read first the display title, second content, third answers;
must not look like a CMS with a Save bar.

Use the season tree on the left, form in the middle, phone preview on the right.
Season title and live controls are in the top bar. Selecting a team opens [M4's history and preview](#m4-admin-team-history).
Shared mobile views provide the middle-pane content.
Use H1/H2 hint interaction instead of D1's always-open hint inputs.
The seasons menu replaces D1's "Seasons /" breadcrumb.

## M1: mobile admin quests

Mock: [HTML](mocks/M1-quests.html), [PNG](mocks/M1-quests.png).

Surface brief: job is seeing the whole season and jumping to a quest; primary action is opening a quest;
read first arc names, second quest titles, third points; must not show drag handles or per-row buttons.

Use Quests / Teams / Settings tabs and the live strip. Arc rows have Ordered/Random controls;
quest rows show title and points, with `+ Quest in <arc>` and "+ Arc" after their lists.
Tap an arc title to rename it; opening a newly added quest goes directly to its editor.
Quest rows show internal title, else display title, else muted `Untitled quest`. Missing points show muted `–`.
Tapping an arc title opens an H2-style panel with an `Arc title` field, `Remove arc` and `Done`.
Done, Enter or Escape close it.
Add and remove controls show before start and while live; ended seasons show neither.
Removing a quest is a quiet link at the bottom of its page.
Removing an arc with quests, or any quest, confirms in End game's `<dialog>` style.
Desktop tree rows are 44 px tall. D1's 36 px rows are superseded.
After start, long presses on quest and arc rows do nothing; taps still open them.
Drag states follow these accepted variants on phone and desktop:

- Arc lift, variant B:
  - [Phone](https://artifacts.senth.org/b-arcs-fold-phone-9f074c.png)
  - [Desktop](https://artifacts.senth.org/b-arcs-fold-desktop-618ac5.png)
- Quest crossing arcs, variant C:
  - [Phone](https://artifacts.senth.org/c-quest-slot-only-phone-baea6e.png)
  - [Desktop](https://artifacts.senth.org/c-quest-slot-only-desktop-747b64.png)
- Empty arc drop, variant E:
  - [Phone](https://artifacts.senth.org/e-quest-into-empty-arc-phone-e4231b.png)
  - [Desktop](https://artifacts.senth.org/e-quest-into-empty-arc-desktop-059da9.png)

While an arc is lifted by pointer, every arc folds to one header row with its title and `N quests · Random|Ordered`.
Empty headers use `No quests · Random|Ordered`.
Hide `+ Quest` and `+ Arc` links while folded; keyboard arc moves do not fold.
A quest crossing arcs shows only H1's dashed slot, without a target-arc highlight; `+ Quest` links stay visible.
An empty arc accepts a drop, with the slot as its only row.
In C and E, mute source-arc rows too; Lighthouse's `ink` text in the mocks is superseded.

While live, show completion bars and "N/M done". Tap expands "Completed by" chips, or muted "Nobody yet",
then hints with revealers.
Only one quest stays open at a time. Phone shows "Edit quest ›". Desktop block stays open above form,
with no Edit link.
PROJECT.md owns the visibility window for these stats.

### Missing-field warnings

Final variant A:

- [Phone](https://artifacts.senth.org/a-phone-e8d3dc.png)
- [Desktop](https://artifacts.senth.org/a-desktop-d4d944.png)

Use [PROJECT.md's completeness rule](PROJECT.md#nested-types), shared with Add to game.
Warnings show from first open, in every season state, including ended seasons and hidden drafts. Keep the draft note.
Use the complete seed and isolated incomplete-drafts variant from [TESTS.md](TESTS.md#development-fixture).

Tree rows place an inline SVG `warn` triangle immediately after the quest name on phone and desktop.
Keep quest names and markers on one line, truncating names as needed. No arc markers or season count.
Quest labels follow the tree rule above: internal title, else display title, else "Untitled quest".
The icon has `role="img"` and `aria-label="Missing <fields>"`. Use lowercase field names joined as "a, b and c".
The tree follows the saved season; editor warnings follow each field's local value and clear while typing.

Missing editor fields get a `warn` border and a `mt-1.5 font-cond text-xs text-warn` line below:

- Display title is optional and never gets a missing-field warning.
- Content: "Needs content or a file", only when both content and asset are empty.
- Answers: "Needs an answer".
- Points: "Needs points".

Link the line with `aria-describedby`. Missing-only fields use neither `aria-invalid` nor `role="alert"`.
A failed save's "Not saved" line replaces the missing line while the failure lasts.
See [Start now confirmation](#start-now-confirmation) for the live strip dialog.

### Live structural edits

Final mocks supersede M1 and M2 for these states:

- [Phone](https://artifacts.senth.org/final-phone-2eb100.png)
- [Desktop](https://artifacts.senth.org/final-desktop-e441d2.png)
- [Desktop dialog](https://artifacts.senth.org/final-desktop-dialog-3f9af6.png)

Draft rows use a muted title and second line, `font-cond text-xs text-muted`, reading "Draft · teams don't see it".
Points show muted `–` or their value. Show no live stats or chevron.

Dialogs read first affected count, second consequences, third Cancel and confirm.
Keep secondary links and solved-team footnotes quiet.
Use the existing native `<dialog>` style. While impact loads, show muted "Counting teams…" and disable confirm.
Use accent for "Add to game" and red for removals.
See [PROJECT.md](PROJECT.md#authoring-and-live-edits) for impact rules and count timing.

Live removal dialogs share this impact body:

- Count: `<N> teams affected`, "1 team affected" or "No team is affected", in `font-cond text-sm text-head`.
- Group labels use `.label` style. Current-team chips use `bg-warn/15 text-warn`; unreached-team chips use `z2`.
- Omit empty groups. With no affected teams, show no groups.
- Footnote: `<K> teams solved it and keep their points.`, in `font-cond text-xs text-muted`. Omit when K is zero.

Live Remove arc dialog:

- Title: `Remove <arc>?`. Body line: `This also removes its <n> quests.`.
- Groups: "On one of them now · skips it with 0 points" and "Quests left in it · they leave their order".
- Footnote: `<K> teams solved every quest in it and keep their points.`. Omit when K is zero.
- Confirm: "Remove arc". Empty arcs and arcs containing only hidden drafts keep the plain confirmation.

### Copy to another season

Final mocks cover arc panels, both copy dialogs and their results:

- [Phone, panels 1 to 6](https://artifacts.senth.org/final-phone-1b87be.png)
- [Desktop arc dialog](https://artifacts.senth.org/final-desktop-arc-afb4fd.png)
- [Desktop quest dialog](https://artifacts.senth.org/final-desktop-quest-e155e3.png)

Use [PROJECT.md's copy rules](PROJECT.md#authoring-and-live-edits) for destinations and copied data.
Show a quiet `text-link` "Copy to another season…" button in every source season state, on phone and desktop.
In the arc title panel, put it between Arc title and Remove arc.
At the quest editor's bottom, put it above Remove quest when present. Keep removal's existing visibility rules.

Arc copy's primary action is "Copy arc". Read source arc and summary first, destination season second, result third.
Quest copy's primary action is "Copy quest".
Read source quest and summary first, destination arc under its season second, result third.
Neither dialog suggests linked content. Avoid "link", "sync", "share" and "import" in dialog copy.
Show no per-season stats or separate season step. Quest copy must not look like a file picker.
Quiet summaries, independence lines, season headers, New arc rows and Cancel. Emphasize the selected destination.

Use the existing native `<dialog>` style with an accent confirm button.
While loading, show muted "Finding seasons…" and disable confirm.
With no destination, show muted "No season is waiting to start. Create one first." and Close only.
Errors use the dialog's existing error slot. Keep it open so the admin can choose another destination.
Radio rows use `min-h-12`, titles `text-sm`, and status `font-cond text-xs text-muted`.
Status reads "Not started" or `Upcoming · <d MMM>`.
Selected rows use `bg-accent/15`, `text-head` and an accent radio.
Pluralize summary and result counts, including "1 quest" and "1 hint".

Arc dialog, panels 1 to 3:

- Title: `Copy <arc>`.
- Summary: `From <season> · <n> quests · <h> hints`, in `font-cond text-sm text-muted`.
- Label: "To season". List destination seasons as radio rows; select the first initially.
- Independence line: "The copy gets its own quests. Editing one season never changes the other."
- Style the independence line `font-cond text-xs text-muted`. Confirm: "Copy arc".
- Result body: `<arc> is now the last arc there, with <n> new quests.`
- "Open it ›" goes to `/admin/seasons/<dest>`.

Quest dialog, panels 4 to 6:

- Title: `Copy <label>`. Use internal title, else display title, else "this quest".
- Summary: `From <season> · <arc> · <h> hints`, in `font-cond text-sm text-muted`.
- Label: "Into arc". Each season is a header with `font-cond text-sm text-head` title and right-aligned muted status.
- Indent its arc radio rows, then a `text-link` "New arc" row with the source arc title in muted quotes.
- Select the first arc of the first season initially, or its New arc row when it has no arcs.
- Independence line: "The copy is a new quest. Editing one season never changes the other."
- Style the independence line `font-cond text-xs text-muted`. Confirm: "Copy quest".
- Result body: `<label> is now the last quest in <arc>.`
- "Open it ›" goes to `/admin/seasons/<dest>/quests/<newQuestId>`.

Success replaces either dialog's contents with title `Copied to <season>` and its result body.
Show Close and outline "Open it ›" in `text-link`.

## M2: mobile quest editor

Mock: [HTML](mocks/M2-quest-editor.html), [PNG](mocks/M2-quest-editor.png).

Surface brief: job is writing or fixing a quest quickly, often on a phone mid-game;
primary action is editing the content; read first the display title, second content, third answers;
must not look like a CMS with a Save bar.

Use Edit/Preview with the real player view. Fields are display title, internal title, Markdown content,
file, answers, points and admin notes. Answers become chips on Enter or comma and can be removed
with ✕ or Backspace. Keep autosave status visible. "+ Add hint" follows the hint rows.
H1/H2 supersede M2's always-open hint rows, not its field order or Revealed by chips.

- Comma, Enter, paste and leaving the field all turn typed text into chips.
- A duplicate answer clears the input and shows muted "Already an answer".
- Content and Admin notes grow with their text; only the page scrolls.
- The File row follows final mock F's editor panel
  ([phone](https://artifacts.senth.org/f-final-phone-4f838f.png),
  [desktop](https://artifacts.senth.org/f-final-desktop-a8bb05.png)).
- With a file, show a thumbnail for images and SVG, or an 80×56 `bg-z1` tile with the capitalised extension
  (`PDF`, `MP3`, `MP4`, `ZIP`), then short name, bordered `Replace` and quiet `Remove`.
- Without one, show dashed 80×56 `+` tile, muted "No file" and bordered `Upload`.
- Empty-state hint reads "any file up to 50 MB". The file input has no `accept` list.
- While uploading, button reads "Uploading…" and both buttons are disabled.
- Show errors below the row in `font-cond text-xs text-warn`.
- On desktop, dragging a file anywhere over the quest form shows a dashed accent overlay.
  It reads "Drop to replace the file" or "Drop to add a file".
- Remove confirms in the Remove quest dialog style.
- The plain Remove quest dialog reads "Its answers, hints and file go too." when the quest has a file.
- Remove dialog copy:
  - Title: "Remove this image / PDF / audio / video / file?" by kind.
  - Body: "Players stop seeing it and the file is deleted." Confirm: "Remove image / PDF / audio / video / file".
- Error copy:
  - `<name> is <x.x> MB. The limit is 50 MB.` (one decimal; 1 MB = 1024 × 1024 bytes)
  - `Drop one file at a time.`
  - `Not saved, retry` (existing generic failure)
- On desktop, titles share a row, and so do Answers and Points, as D1.

### Puzzle section

Final mock F: [phone](https://artifacts.senth.org/f-editor-phone-6e0687.png),
[desktop](https://artifacts.senth.org/f-editor-desktop-ea3fff.png).

Surface brief: job is turning an uploaded image into a puzzle in seconds, mostly on a phone.
Primary action is the "Puzzle mode" switch. Read first the switch, second Rows and Columns, third "Show full picture".
Must not look like another upload section or settings page. Remove nothing from the File row.
Quiet the section when unused; sharpen only the locked line when applicable.
Use [PROJECT.md's puzzle rules](PROJECT.md#puzzle-quests) for eligibility, locks and answer requirements.

Place a "Puzzle" field after Points and before Admin notes, using M2's field style.
Without an image, show only `font-cond text-xs text-muted` "Upload an image to enable puzzle mode."
With an image, use a `bg-z1 rounded-md p-3 space-y-3` block:

- "Puzzle mode" switch, with helper "Players get shuffled pieces, never the picture."
- While on, show Rows and Columns number inputs, using Length's width and PROJECT.md's dimension bounds.
- Out-of-range input shows `warn` "Use 2 to 7."
- "Show full picture" switch, with helper "Players see the picture above the pieces."

Disable and mute locked controls, including Replace and Remove; keep Show full picture editable.
Show a muted line: `Locked: <N> teams have reached this puzzle.` or "Locked: 1 team has reached this puzzle."
With puzzle mode on, Answers helper reads "optional, finishing the puzzle solves it".
Use ordinary field autosave and the header's Saved state.
Missing-field warnings follow [PROJECT.md's completeness rule](PROJECT.md#nested-types).
Puzzle quests do not show "Needs an answer".
`components/admin/puzzle-settings.tsx` owns the section, composed by `components/admin/quest-editor.tsx`
with the shared autosave controls.

### Live draft and quest dialogs

Use the [final structural-edit mocks](#live-structural-edits), panels 2 through 4, on phone and desktop.
Put a `bg-z1 rounded-md p-3` draft note above Display title.

- Not ready: `Fill in <fields> to add it to the game.`. Use lowercase field names joined as "a, b and c".
- Display title never counts as missing. Content counts as missing only without content or an asset.
- Disable the accent "Add to game" button until ready. Missing fields keep their warn border and line.
- Ready: "Teams don't see this quest yet.". Enable "Add to game".
- After adding succeeds, remove the note on `season:<id>` refresh and show the tree row's live stats.

Add dialog copy:

- Title: `Add <label> for <N> teams?`.
- Body: "Each team gets it at a random spot after its current quest.".
- When completed teams exist, add muted `<K> teams finished and don't get it.`.
- For N = 0, title: `Add <label> to the game?`.
  Body: "No team is playing it yet. Teams that start later get it.".
- Confirm: accent "Add to game".

Live Remove quest dialog uses the [shared impact body](#live-structural-edits):

- Title: `Remove <label>?`.
- Groups: "On it now · skips it with 0 points" and "Not reached · leaves their order".
- Confirm: red "Remove quest". Omit "Its answers, hints and file go too." from this live impact dialog.
- Hidden drafts keep the plain confirmation, including its answers, hints and file copy.

`<label>` uses internal title, else display title, else "this quest".

## M3: admin teams

Mock: [HTML](mocks/M3-teams.html), [PNG](mocks/M3-teams.png).

Surface brief: job is checking how every team is doing; primary action is opening a team;
read first rank and points, second the rail, third hint loss; must not look like a user-management table.

Add a team inline with name and password. Rows show rank, name, points, rail, current quest,
and hint loss such as "−15p hints" or "no hints". Open a row for team detail.
The desktop middle pane uses the same list.
[PROJECT.md](PROJECT.md#answers-hints-and-score) defines hint loss.
Its [teams section](PROJECT.md#teams) owns adding and deleting teams.
Use `muted` for "no hints" and `warn` for a loss.

Status lines depend on team and season state:

- Running: `On <quest>`.
- Finished: "Finished every quest".
- Ended, unfinished: `Stopped on <quest>`.
- Before start: no status line. Hide ranks and sort by name.

Use the admin quest label: internal title, else display title. The current rail segment is blue only while running.

Delete team is a red-outline button at the bottom of the team page, never on a list row.
It opens a native `<dialog>` with this copy:

- Title: `Delete <name>?`.
- Body: `Its score and quest history are deleted. Every phone logged in as <name> is logged out.`
- Buttons: "Cancel" and red "Delete team".

Team detail follows [M4's history, actions and preview](#m4-admin-team-history).

## H1: hints at rest and mid-drag

Mock: [HTML](mocks/H1-hints-drag.html), [PNG](mocks/H1-hints-drag.png).

Surface brief: job is adding or fixing a hint fast; primary action is "+ Add hint";
read first hint text, second penalty, third who revealed it; must not show inputs at rest.

Each resting row is one truncated line with its penalty right-aligned. Use the lifted row and dashed slot
for dragging, with no handle. "Worth with all hints" updates immediately when penalties change.
Desktop uses the same dashed slot; D1's accent drop line is superseded.
Revealed by chips follow PROJECT.md's visibility rule, including on desktop.

## H2: hint edit mode

Mock: [HTML](mocks/H2-hint-edit.html), [PNG](mocks/H2-hint-edit.png).

Surface brief: job is adding or fixing a hint fast; primary action is "+ Add hint";
read first hint text, second penalty, third who revealed it; must not show inputs at rest.

Tapping a row opens textarea, points, Remove and Done. Done collapses the row; field saving still uses autosave.
Removing a hint asks for confirmation if any team has revealed it. Other rows remain quiet text.

## M4: admin team history

Mock: [HTML](mocks/M4-team.html), [PNG](mocks/M4-team.png).

Surface brief: job is understanding one team's game and what they see right now;
primary action is none (read-only plus reset password); read first score and pace, second the quest list,
third the preview; must not wrap hint lines.

Show score, `N / M solved`, then `−Np from hints` in `warn` or muted "No hints", then the state line.
Use [PROJECT.md's hint-loss total](PROJECT.md#answers-hints-and-score) and [pace rules](PROJECT.md#pace).
Show no rank.

- Running: "N behind pace", "N ahead of pace" or "On pace", in the pace band's color.
- Before start: muted "Not started".
- Ended, unfinished: muted "Game ended".
- Finished, during or after play: "Finished" in `pace-ok`.

Group quests by arcs in authored order. Use [M3's admin quest label](#m3-admin-teams).
Each quest has a status marker, title and earnings or status in the right column.

- Solved: ✓ and `+Np`.
- Current while running: blue dot, accent tint and "Now".
- After end: the unfinished current quest has a hollow ring and muted "Stopped", without tint.
- Unreached: a `z2` dot.

Each revealed hint gets one line below the title, with its label, truncated snapshot text and snapshot penalty at right.
Hint lines never wrap. Labels use the hint's position in the quest, H1/H2, matching Intel's numbers.
A hint deleted since reveal reads "H?". Sort by position, with unknown positions last.

Quests removed during play follow the arcs in a muted "Removed during play" group. Keep their hint lines.
Rows read "Removed quest", with × and "Skipped · 0p", or ✓ and `+Np` if solved before removal.

Reset password is a quiet link below the history. It opens a visible-text field, Cancel and an outline "Set password".
Label the field "Reset password". Helper copy: "Phones already logged in stay in. Old QR links stop working."
Success closes the field and shows muted "Password changed." beside the link until reopening or leaving the page.
Cancel and Escape close without saving and clear the input. Use [PROJECT.md's password-reset rules](PROJECT.md#teams).

Phone order is stats, history, Reset password, Delete team, then preview.
Delete team is last in the history, above the preview. Use [M3's delete control and confirmation](#m3-admin-teams).
Desktop keeps stats, history and actions in the middle pane, with preview only in the right pane, replacing its placeholder.

The preview heading is `What <team> see now`, with muted "live".
Render the team's real screen, including waiting, countdown, "Time's up." and "You solved every quest." states.
While running, show the team's quest, revealed hints, pace and standings strip.
Hints and the answer dock stay inert. The standings strip and "Standings ›" are not links.
Hide Log out, the team menu and the QR code. Use the real player header, not the mock iframe's superseded pace wording.

## Unmocked surfaces

### Login and registration

Login surface brief: job is getting into the game fast on a phone; primary action "Log in";
read first the field labels, second the button, third the register link;
must not look like a marketing landing page; remove everything but the form and the game name.

Registration surface brief: job is creating a team in under 20 s; primary action "Create team";
read first name, second password, third the login link;
must not look like an account signup with terms and emails.

### Player lifecycle states

Surface brief: job is knowing what happens next; no primary action;
read first the state sentence, second the countdown or score; must not look like an error page.

Waiting, countdown, completed and ended use one state sentence with the relevant time or score.
Completed and ended put shared ordinal such as `7th of 10` below score, then a `Standings ›` link.
Ties use shared place such as `2nd of 10`, without a `Tied` label.

### Admin seasons list

Surface brief: job is getting into the season you want; primary action "New season";
read first the running or next season, second the past ones; must not look like an analytics dashboard.

Desktop at 1024 px and up uses layout F: seasons are roots of the left menu.
The open season expands in place under its row.
Phone uses layout A: a list at `/admin`, then M1's header, live pill and tabs inside a season.
Group current seasons first: live, then upcoming by soonest start, then unscheduled by title.
Past seasons follow, newest start first, quieted with `muted`.
Phone rows show "Live · 47:27 left", "Upcoming" or "Not started"; desktop menu rows show a short day or month.
Past rows show only their date.
The live pill is the only colored element in the list.
Desktop puts "+ New season" at the top of the menu; phone puts a "New season" button in the header.
Show no counts, charts, stat tiles or cards.

### Season settings and live strip

Live strip surface brief: job is running a season and changing its end time.
Primary action is "Start now" before play, "End game" while live.
Read first live-state pill, second time controls, third Settings below.
Must not look like analytics: no counts, charts or stat tiles.
On phone, live strip sits below header with full-width controls, as M1.
On desktop, it sits in top bar right of Saved, as D1.
Keep −5 / +5 as outlines. End game uses `pace-3` and confirms in a native `<dialog>`.

Settings surface brief: job is setting up a season before play and checking it during play.
Primary action is editing a field.
Read first season title, second start, length and new quest points, third shuffle and registration.
Must not look like a CMS form with a Save bar or preferences dashboard.
Stack fields in M2's field style; booleans are switches. Quiet locked fields once live.
Show errors as `warn` lines at the field.

New quest points follows final variant G: [phone](https://artifacts.senth.org/g-phone-b70c01.png) and
[desktop](https://artifacts.senth.org/g-desktop-ef9e7b.png).
Empty state: [phone](https://artifacts.senth.org/d-phone-2b4a8a.png) and [desktop](https://artifacts.senth.org/d-desktop-c1dd89.png).
Place it directly under Length, before Shuffle arcs. Label it "New quest points", with suffix `p` and placeholder "None".
Use the same input width as Length. Never lock it or make it read-only.
With a value, show `New quests start with <N>p. Existing quests never change.`
When empty, show "Empty means new quests start without points. Existing quests never change."
The helper follows the typed value before the save lands.
Use [PROJECT.md's default quest points rule](PROJECT.md#nested-types) for behavior.

#### Start now confirmation

Follow [PROJECT.md's Start now rule](PROJECT.md#lifecycle-and-season-lookup) and the [missing-field mocks](#missing-field-warnings).
Use the existing native `<dialog>` style on phone and desktop.
Title: `Start with <N> incomplete quests?`, or `Start with 1 incomplete quest?`.
List quests in authored arc and quest order, including hidden drafts.
Each row shows the [tree quest label](#missing-field-warnings) and its missing fields in `warn`.
Display title never counts as missing. Content counts as missing only without content or an asset.
Missing-field text may wrap. Show at most five quest rows, then muted `and <K> more` for the remainder.
Body: "Teams get them as they are. A quest without answers or a puzzle can't be solved."
Buttons: "Cancel" and accent "Start anyway". Cancel leaves the season unstarted; Start anyway starts it.
Complete seasons start in one click without this dialog. Scheduling a future start shows no warning.

### Public TV board

Surface brief: job is letting a room watch the race; no actions;
read first the ranking, second the time left; must not need scrolling with 10 teams.

Use a fixed 1920×1080 stage, scaled to fit and letterboxed; phones and portrait screens keep the same stage.
Rows show rank, name, rail, solved/total and points on one line; both columns retain rails.
Use one column through 12 teams and two above 12, ranked top to bottom; clip rows beyond 24.
Rows share the height left after title and footer, capped at 76 px; text sizes and padding stay fixed.
Omit per-team pace blocks.
Place season time bar at bottom; after season ends, replace it with "Final" alone.
With no game running, center muted "No game running"; never show a blank screen.
Body text is at least 28 px for viewing from 3 m.

## Finisher bonus

Final mocks:

- [Phone](https://artifacts.senth.org/final-phone-452833.png)
- [Desktop](https://artifacts.senth.org/final-desktop-82bbf1.png)

[PROJECT.md](PROJECT.md#finisher-bonus) owns place, points and ordering rules. This section owns their presentation.
Use board option 1, a ribbon for bonus finishes and a slim banner otherwise. Option 2 is rejected.
Use `pace-ok` for flags, bonus earnings and the ribbon's green left border.

### Settings rows

Job: setting finisher bonuses before or during play. Primary action: "+ Add place".
Read row ordinals and points first, winners second, help third.
Do not make a spreadsheet or CMS form with a Save bar.
Remove per-row delete buttons except on the last row. Quiet claimed rows; sharpen the last row's ✕ and "+ Add place".

Place this group after shuffle and registration. Use existing field autosave and the header's Saved state.

- Label: "Finisher bonus".
- Help: "Points for the first teams to finish. Row 1 is first place."
- Empty state: "No bonus". Add link: "+ Add place".
- Rows show "1st", "2nd", "3rd", then the points input and a muted "p".
- Claimed rows show muted ordinal and points, then a green flag and team name. No input or ✕.
- Show ✕ only on the last unclaimed row.
- Rejected edits show a `warn` line: "Already won, can't change".

`components/admin/finisher-bonus-rows.tsx` owns the rows, composed by `components/admin/season-settings.tsx`.

### Flags, completed line and team history

Job: seeing who finished and who earned a bonus. Each screen's primary action stays unchanged.
Read rank and points first, flag and bonus second, rail third.
Do not compete with points or add a place column. Remove finish-place chips and ordinal markers from ranking rows.
Quiet the strip's flag. Sharpen "+Np" beside the flag in standings and on the board.

Use one shared inline SVG flag, never emoji. Its `aria-label` reads "Finished" or "Finished, +50p bonus".
Standings show the flag after the name, with bold "+50p" for positive bonuses only.
The game strip shows the flag only, never "+Np". Board rows show the flag and positive bonus at board size.
Zero-point finishers still get flags.

On the completed screen, put a green flag line under the score only for positive bonuses.
Copy: "First to finish · +50p", or "2nd to finish · +20p". Keep the existing points rank, such as "1st of 10".
In M4, put a "Finisher bonus" group after the arcs and before "Removed during play", only for positive bonuses.
Its row shows a flag, "Finished 1st" and "+50p" in `pace-ok`.

Extend `components/standings/standings-list.tsx` and `components/game/standings-strip.tsx` for ranking flags.
`components/board/board-list.tsx` owns board flags.
`components/game/lifecycle-screen.tsx` owns the completed line; `components/admin/team-history.tsx` owns the history group.

### Live notices

Job: noticing a team just finished and whether a bonus remains. No primary action; a tap dismisses.
Read who finished first, "+Np" second, next open place third.
Do not make a modal, celebration overlay or push-notification card. No confetti or emoji.
Remove notices from admin pages, standings and the completed screen.
Quiet no-bonus finishes with a strip notice on the game screen. Sharpen the ribbon's green left border and points.

The first render sets a baseline without replaying old finishes.
Queue new finishes in place order after refetch, showing one at a time.
Skip the finishing team's own phones; their completed screen covers it.
Use `aria-live="polite"` for announcements.

`components/game/finish-ribbon.tsx` owns the positive-bonus ribbon under the game header:

- Header: flag, `<Team> finished 1st`, with "+50p" at right.
- Muted second line: "2nd still open for +20p", or "No bonus left".
- Slide down over 250 ms, pushing the quest. Stay 8 seconds, then slide up. A tap closes it.

For zero-point finishes, `components/game/standings-strip.tsx` cross-fades a flag and `<Team> finished 3rd` over the strip.
Stay 6 seconds, then cross-fade back. The quest does not move.
The board shows a large ribbon under the title for bonus finishes, a slim banner otherwise, with the same timings.
Board rows share the remaining height under the existing 76 px cap. Nothing overlaps the footer.
New flags fade in on standings and the board.
With `prefers-reduced-motion`, use fades only, never sliding.

## Anti-references

No gradient heroes, card-in-card layouts, decorative stat tiles or emoji icons.
Do not turn a quest into a dashboard, the editor into a CMS Save workflow, or teams into a user-management table.
Do not replace the navy palette or fonts because another style is fashionable.
