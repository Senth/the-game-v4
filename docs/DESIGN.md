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
- Keyboard reordering uses Alt+↑/↓ for the focused row and Alt+Shift+↑/↓ for a quest's neighboring arc.
- Honor `prefers-reduced-motion`. A hint still requires its full hold, but its fill does not animate.
- Autosave state belongs in the header, not a Save bar. Use the exact states defined in PROJECT.md.
- Mark internal titles and admin notes "admin only". Keep them out of real player previews.

## Component ownership

`app/globals.css` owns runtime tokens. `app/` owns routing and page composition.
`components/` owns shared game content, rail, Intel, answer dock and the admin list/editor views.
Extend those shared implementations rather than copying layouts into routes.
Desktop reuses the mobile quests, teams and team-history components in its middle pane.
Desktop phone frame and mobile Edit/Preview render the real player components, not a second rendering system.
With a team open, the desktop preview shows that team's current quest.

## G2: player game

Mock: [HTML](mocks/G2-game.html), [PNG](mocks/G2-game.png).

Surface brief: job is solving the current quest with teammates; primary action "Send";
read first the quest content, second the time left and pace, third the Intel worth;
must not look like a dashboard; remove "quest N of M", quiet the standings strip, sharpen the answer dock.

Use G2's header, with the shorter "2 behind" wording rather than the mock's "2 quests behind pace".
Timer color follows PROJECT.md. Keep the arc rail and standings strip subordinate to quest content.
The strip itself opens standings; rank is muted, names regular, points bold, and your team tinted.

Quest content has a display title, image or asset, and Markdown with highlighted fences.
Intel shows current/full worth, revealed hints with right-aligned penalties, and locked hold-to-reveal rows.
The fixed answer dock contains only the input and Send. It remains visible at every scroll position.
Wrong-answer feedback is an orange line fading over 4 seconds; correct feedback uses success green.

## S1: player standings

Mock: [HTML](mocks/S1-standings.html), [PNG](mocks/S1-standings.png).

Surface brief: job is answering "how far have we come vs how much time is left, and where do we stand";
primary action is back to the quest; read first your two bars, second your rank, third the other teams;
must not look like a spreadsheet.

Use separate time and quests bars. Put the time tick on the quests bar and a textual percentage pace label nearby.
The time bar uses `time`; the quests bar uses the team's pace color.
Rows show rank, name, solved/total, points and authored-order rail. Your row is tinted.
Ten teams fit without horizontal scrolling at 390 px; updates arrive live.

## D1: desktop admin

Mock: [HTML](mocks/D1-admin-desktop.html), [PNG](mocks/D1-admin-desktop.png).

Season-tree surface brief: job is seeing the whole season and jumping to a quest;
primary action is opening a quest; read first arc names, second quest titles, third points;
must not show drag handles or per-row buttons.

Quest-editor surface brief: job is writing or fixing a quest quickly, often on a phone mid-game;
primary action is editing the content; read first the display title, second content, third answers;
must not look like a CMS with a Save bar.

Use the season tree on the left, form in the middle, phone preview on the right.
Season title and live controls are in the top bar. Selecting a team replaces the middle form with team history
and shows that team's current quest in the right preview. Shared mobile views provide the middle-pane content.
Use H1/H2 hint interaction instead of D1's always-open hint inputs.

## M1: mobile admin quests

Mock: [HTML](mocks/M1-quests.html), [PNG](mocks/M1-quests.png).

Surface brief: job is seeing the whole season and jumping to a quest; primary action is opening a quest;
read first arc names, second quest titles, third points; must not show drag handles or per-row buttons.

Use Quests / Teams / Settings tabs and the live strip. Arc rows have Ordered/Random controls;
quest rows show title and points, with `+ Quest in <arc>` and "+ Arc" after their lists.
Tap an arc title to rename it; opening a newly added quest goes directly to its editor.
While live, show completion bars and "N/M done". Tap expands Completed by chips, hints with revealers,
and "Edit quest ›". The same live block appears above the desktop form.
PROJECT.md owns the visibility window for these stats.

## M2: mobile quest editor

Mock: [HTML](mocks/M2-quest-editor.html), [PNG](mocks/M2-quest-editor.png).

Surface brief: job is writing or fixing a quest quickly, often on a phone mid-game;
primary action is editing the content; read first the display title, second content, third answers;
must not look like a CMS with a Save bar.

Use Edit/Preview with the real player view. Fields are display title, internal title, Markdown content,
image, answers, points and admin notes. Answers become chips on Enter or comma and can be removed
with ✕ or Backspace. Keep autosave status visible. "+ Add hint" follows the hint rows.
H1/H2 supersede M2's always-open hint rows, not its field order or Revealed by chips.

## M3: admin teams

Mock: [HTML](mocks/M3-teams.html), [PNG](mocks/M3-teams.png).

Surface brief: job is checking how every team is doing; primary action is opening a team;
read first rank and points, second the rail, third hint loss; must not look like a user-management table.

Add a team inline with name and password. Rows show rank, name, points, rail, current quest,
and hint loss such as "−15p hints" or "no hints". Open a row for team detail.
The desktop middle pane uses the same list. Team deletion requires confirmation.

## H1: hints at rest and mid-drag

Mock: [HTML](mocks/H1-hints-drag.html), [PNG](mocks/H1-hints-drag.png).

Surface brief: job is adding or fixing a hint fast; primary action is "+ Add hint";
read first hint text, second penalty, third who revealed it; must not show inputs at rest.

Each resting row is one truncated line with its penalty right-aligned. Use the lifted row and dashed slot
for dragging, with no handle. "Worth with all hints" updates immediately when penalties change.
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

Show score, solved count, hint loss and pace. Group quests by arcs in authored order.
Each quest has a status marker, title and points earned or "Now" in the right column.
Each revealed hint gets its own line below the title: H1/H2 label, truncated text, penalty at right.
Hint lines never wrap. Mobile ends with the live phone preview; desktop puts that preview in its right pane.
Keep Reset password secondary. Use the revised admin3 mock, not the earlier M4 design.

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

### Admin seasons list

Surface brief: job is getting into the season you want; primary action "New season";
read first the running or next season, second the past ones; must not look like an analytics dashboard.

Use title, status and start time, with D1's desktop or M1's mobile shell.

### Public TV board

Surface brief: job is letting a room watch the race; no actions;
read first the ranking, second the time left; must not need scrolling with 10 teams.

Scale S1's all-teams list and season time bar for 1920×1080. Omit the per-team pace block.
Body text is at least 28 px for viewing from 3 m. Show nothing when no season is running.

## Anti-references

No gradient heroes, card-in-card layouts, decorative stat tiles or emoji icons.
Do not turn a quest into a dashboard, the editor into a CMS Save workflow, or teams into a user-management table.
Do not replace the navy palette or fonts because another style is fashionable.
