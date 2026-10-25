# Design

## Character and authority

The Game keeps v3's dark navy palette and Roboto family. It is a puzzle hunt, not a dashboard.
Quest content gets the player's attention; admin tools stay dense enough to run a game from a phone.
New surfaces use this same language, not a new visual direction.

`app/globals.css` owns the runtime token values.
[PROJECT.md](PROJECT.md) alone defines pace math, rail meaning, standings-strip selection and game rules.

## Tokens

Declare colors as `--color-<token>` in `@theme`; `app/globals.css` holds the values.
The mock-only aliases `ok`, `you`, `team` and `accent-strong` are not application tokens.
Use `pace-ok` for success and `accent` for your team.

| Tailwind token | Allowed use |
| --- | --- |
| `z0` | Page background and quiet header |
| `z1` | Raised strips, answer dock and recessed tracks |
| `z2` | Separators, neutral chips and lifted drag rows |
| `field` | Inputs and textareas |
| `ink` | Body copy and ordinary names |
| `muted` | Labels, rank, helper copy and secondary values |
| `link` | Navigation, secondary actions and reveal affordances |
| `head` | Headings and emphasized points |
| `accent` | Primary action, current quest, focus and own-team tint |
| `warn` | Wrong answers, hint penalties and missing-field warnings |
| `pace-ok` | On-pace/ahead state, solved segments, correct-answer feedback, finish flags and bonus earnings |
| `pace-1` | First behind band |
| `pace-2` | Second behind band |
| `pace-3` | Last behind band, destructive controls and their borders |
| `time` | Elapsed-time bar, not quest completion |

Fonts: `--font-head` for headings, `--font-body` for quest prose and body text,
`--font-cond` for labels, numbers and buttons. Numbers use tabular figures.

## Layout and interaction rules

- Dark only. No theme switch and no light variants.
- Use one accent for the primary action; secondary actions use quiet link text or a neutral outline.
- Separate regions by background shift or border, never both for the same boundary.
- Keep the player mobile-first at 390 px, without horizontal scrolling.
- Admin has full authoring and live-control capability on phone, not a read-only companion mode.
- At widths of at least 1024 px, use the desktop admin frame; below that, use the mobile frame.
- Use the existing Tailwind spacing, type and radius utilities from the accepted mocks.
  Do not introduce one-off values for ordinary spacing or controls.
- Autosave state belongs in the header, not a Save bar, using the states defined in PROJECT.md.
  Show it only on pages with an autosave field. A failed field gets a `warn` border and a retry control.
- Confirmations and copy flows use the native `<dialog>` style: `accent` confirm for additions,
  `pace-3` for removals and deletions.
- Label internal titles and admin notes as visible to admins only. Keep them out of real player previews.
- Admin labels a quest by internal title, else display title, else a muted untitled placeholder.

### Drag and reorder

- Drag rows have no handles. A 400 ms long press lifts the row; a short tap opens or edits.
  Normal scrolling must not start a drag.
- Hint, quest and arc rows rest as text. Enter editing on tap so a long press never begins inside an input.
- A lifted row and a dashed slot show drag state; untouched rows turn `muted`.
- Use `@dnd-kit` with a delayed `PointerSensor` and a custom `KeyboardSensor`, not another drag implementation.
- Keyboard reordering uses Alt+↑/↓, and Alt+Shift+↑/↓ to move a quest to the neighboring arc.
- A failed move uses the header's retry state. The row stays where it was dropped.

### Missing-field warnings

Completeness comes from [PROJECT.md](PROJECT.md#nested-types), shared with Add to game and Start now.
Warnings show from first open in every season state. A `warn` triangle follows the quest name in the tree.
A missing editor field gets a `warn` border and a `font-cond text-xs text-warn` line below it.
A failed save's line replaces the missing line while the failure lasts.

### Previews

Quest and team previews render the real player components, inert, not a second rendering system.
Hints, the answer dock and standings links do nothing, and previews never request permissions.

### Maps

Maps use the navy style built from the tokens. The place circle is `head`; the own dot is `accent`.
Attribution stays visible, expanded and `muted`.
On touch, one finger scrolls the page and two move the map; one finger still drags the pin and handle.
Size the map's own container, because MapLibre's CSS overrides Tailwind's `absolute inset-0`.
`components/map/lazy-map.tsx` is the only entry; never import MapLibre elsewhere.

### Finish flags

Use one shared inline SVG flag, `components/finish-flag.tsx`, never emoji.
Standings, strip, board, completed screen and team history show it in `pace-ok`.

## Component ownership

`app/globals.css` owns runtime tokens. `app/` owns routing and page composition.
Extend the owning component rather than copying layouts into routes.
Desktop admin reuses the mobile quests, teams and team-history components in its middle pane.

| Surface | Owner |
| --- | --- |
| Game screen, header, quest content | `components/game/game-screen.tsx`, `game-header.tsx`, `quest-content.tsx` |
| Intel, answer dock, asset audio | `components/game/intel.tsx`, `answer-dock.tsx`, `audio-bar.tsx` |
| Rail and standings strip | `components/game/arc-rail.tsx`, `standings-strip.tsx` |
| Waiting, countdown, completed, ended | `components/game/lifecycle-screen.tsx` |
| Location dock and place map | `components/game/location-dock.tsx`, `place-map.tsx`, `use-location-reporter.ts` |
| Puzzle board | `components/game/puzzle-board.tsx` |
| Team menu and invite | `components/game/team-menu.tsx`, `invite-dialog.tsx` |
| Finish ribbon and notices | `components/game/finish-ribbon.tsx` |
| Player standings | `components/standings/standings-screen.tsx`, `standings-list.tsx` |
| Public TV board | `components/board/board-screen.tsx`, `board-list.tsx`, `board-stage.tsx` |
| Login and registration | `components/auth-frame.tsx`, `app/login/login-form.tsx`, `app/register/register-form.tsx` |
| Admin frame, seasons list and menu | `components/admin/admin-frame.tsx`, `season-list.tsx`, `season-menu.tsx` |
| Season tree and drag | `components/admin/season-tree.tsx`, `components/admin/sortable/drag-layer.tsx` |
| Live strip and settings | `components/admin/live-controls.tsx`, `season-settings.tsx` |
| Quest editor and fields | `components/admin/quest-editor.tsx`, `place-field.tsx`, `puzzle-settings.tsx`, `hints-editor.tsx` |
| Quest and team previews | `components/admin/quest-preview.tsx`, `team-preview.tsx`, `season-preview.tsx` |
| Teams list and history | `components/admin/teams-list.tsx`, `team-history.tsx`, `reset-password.tsx` |
| Season-level fields | `components/admin/map-area-field.tsx`, `new-quest-points-field.tsx`, `finisher-bonus-rows.tsx` |
| Dialogs | `components/admin/confirm-dialog.tsx`, `copy-dialog.tsx`, `removal-impact.tsx` |
| Autosave controls and status | `components/admin/autosave-provider.tsx`, `save-status.tsx` |

## Anti-references

No gradient heroes, card-in-card layouts, decorative stat tiles or emoji icons.
Do not turn a quest into a dashboard, the editor into a CMS Save workflow, or teams into a user-management table.
Admin season lists and live strips show no counts, charts or stat tiles.
Lifecycle states and the login form never look like an error page or a marketing landing page.
Do not replace the navy palette or fonts because another style is fashionable.
