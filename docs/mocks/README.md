# Accepted mocks

These nine HTML/PNG pairs are the accepted visual references. The committed files remain available
after the hosted previews expire. [DESIGN.md](../DESIGN.md) owns surface briefs and visual rules;
[PROJECT.md](../PROJECT.md) owns behavior, pace math, rails and standings selection.

| Id | HTML | PNG | Shows |
| --- | --- | --- | --- |
| G2 | [G2-game.html](G2-game.html) | [G2-game.png](G2-game.png) | Player header, standings strip, quest, Intel and answer dock |
| S1 | [S1-standings.html](S1-standings.html) | [S1-standings.png](S1-standings.png) | Separate time/quests bars, tick, ranked teams and rails |
| D1 | [D1-admin-desktop.html](D1-admin-desktop.html) | [D1-admin-desktop.png](D1-admin-desktop.png) | Three-pane admin, live strip and tree drag state |
| M1 | [M1-quests.html](M1-quests.html) | [M1-quests.png](M1-quests.png) | Mobile quests tab, live stats and inline expansion |
| M2 | [M2-quest-editor.html](M2-quest-editor.html) | [M2-quest-editor.png](M2-quest-editor.png) | Mobile quest fields, autosave and Edit/Preview |
| M3 | [M3-teams.html](M3-teams.html) | [M3-teams.png](M3-teams.png) | Mobile teams tab with rails and hint losses |
| H1 | [H1-hints-drag.html](H1-hints-drag.html) | [H1-hints-drag.png](H1-hints-drag.png) | Hint text rows at rest and lifted drag row |
| H2 | [H2-hint-edit.html](H2-hint-edit.html) | [H2-hint-edit.png](H2-hint-edit.png) | Hint tapped into edit mode |
| M4 | [M4-team.html](M4-team.html) | [M4-team.png](M4-team.png) | Revised team history, single-line hints and player preview |

## Superseded details

- G2's "2 quests behind pace" becomes "2 behind". Use the general header wording from PROJECT.md.
- M2 and D1's always-open hint inputs are superseded by H1 resting/drag rows and H2 tap-to-edit.
  Keep M2's Revealed by chips, hidden until the season starts.
- M4 is the revised admin3 version: hint text lines below each quest title, points in the right column.
  Do not use the earlier admin2 M4.
- The mock-only color aliases and one-off colors are not additions to DESIGN.md's application palette.
- Some mock controls are visibly shorter than 44 px; implementation must provide 44 px touch targets.
- Some mock regions combine background and border; implementation follows DESIGN.md's single-separator rule.
- Static names, scores, hint-loss totals and clock values illustrate layouts, not alternate domain rules.

The HTML files are static references, not working application code. They use remote Google Fonts,
Tailwind's browser CDN and placeholder images. PNGs preserve the accepted appearance without those services.
D1 and M4 iframe sources are rewritten to the relative sibling `G2-game.html`.

## Source mapping

| Committed base name | v3 source under `.tmp/mocks/` |
| --- | --- |
| `G2-game` | `game2/G2-tinted` |
| `S1-standings` | `game2/S1-two-bars` |
| `D1-admin-desktop` | `admin2/D1-tree` |
| `M1-quests` | `admin2/M1-quests-live` |
| `M2-quest-editor` | `admin2/M2-quest-edit` |
| `M3-teams` | `admin2/M3-teams` |
| `H1-hints-drag` | `admin3/H1-drag` |
| `H2-hint-edit` | `admin3/H2-edit` |
| `M4-team` | `admin3/M4-team` |

Each mapping applies to both `.html` and `.png`. Sources are copied without restyling.

## Local preview proof

Serve this directory with `python3 -m http.server --bind 127.0.0.1 --directory docs/mocks 8000`
from the repo root. Fetch `http://127.0.0.1:8000/D1-admin-desktop.html`, then resolve its iframe
source against that URL and fetch it. Both D1 and M4 must resolve to `G2-game.html` with HTTP 200.
Agents use HTTP requests for this check; they do not drive the app by hand.
