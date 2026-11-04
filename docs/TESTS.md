# Tests

- `lib/domain/` tests are pure. `lib/db/` tests use `mongodb-memory-server` with a fresh database per file.
- Write a red regression test first for a reproducible bug.
- Put rule and interaction cases in unit or component tests. Add no browser flows.
- Mock geolocation, compass sensors, map tiles and Nominatim. Never call live services.

## End-to-end

`pnpm e2e` runs one core-loop smoke test after `pnpm build`, under 60 seconds.
It boots its own database and app. Only its setup sets `E2E_START_COUNTDOWN_MS`.

## Development fixture

`scripts/fixture.ts` defines "Cipher Night 2026". `scripts/fixture.test.ts` pins it.
Log in as `admin / admin` or `Ninjas / ninjas`. Other teams use their lowercased name.
Never deploy these passwords. Unrevealed hints and unplayed quests are intentional.
