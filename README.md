# The Game

The Game is a timed puzzle hunt where teams share a login across phones.
Game masters author quests and run seasons with live progress updates.
It uses Next.js 16, React 19, Tailwind CSS 4 and MongoDB 8.
See [project rules](docs/PROJECT.md) and [design](docs/DESIGN.md) for the contracts.

## Local development

Use Node 24 LTS and pnpm, with the version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` allocates checkout-specific ports, starts local MongoDB and seeds an empty database.
Open the URL it prints. No Docker needed.
See [AGENTS.md](AGENTS.md) for commands and gates, and [test fixtures](docs/TESTS.md#development-fixture) for local accounts.
Never use fixture passwords in production.

## Environment variables

Runtime defaults below distinguish the production image from local development.
Compose supplies `MONGODB_URI` and `SESSION_SECRET`; the image supplies its remaining runtime defaults.
Do not set test overrides in production.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MONGODB_URI` | App and database scripts | None; compose uses `mongodb://mongo:27017/the-game` | MongoDB connection. `pnpm dev` supplies local MongoDB when unset. |
| `SESSION_SECRET` | Production | None in production; fixed local development secret | Session encryption secret, at least 32 characters. |
| `ASSETS_DIR` | Real v3 imports | `.tmp/assets` locally; `/data/assets` in image | Uploaded and imported asset storage. |
| `PORT` | No | `3000` in image | Standalone server port. Development allocates a checkout port instead. |
| `HOSTNAME` | No | `0.0.0.0` in image | Standalone server bind address, not the public domain. |
| `NODE_ENV` | Production | `production` in image; `development` with `pnpm dev` | Runtime mode and secure session cookies. |
| `E2E_START_COUNTDOWN_MS` | No, tests only | `20000` | Start countdown override; e2e uses `1000`. Never set in production. |
| `E2E_BASE_URL` | Tests only, setup supplies it | Allocated local test URL | Core-loop test target. Never point at production. |
| `DEV_STACK_REGISTRY` | No | `~/.local/state/dev-ports` | Shared local port registry. |
| `DEV_STACK_WEB_TIMEOUT` | No | `180` | Seconds `scripts/dev-stack.sh up` waits for development server readiness. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Only without other Application Default Credentials | None | Credential file for the Firestore export CLI, not the deployed app. |
| `NEXT_TELEMETRY_DISABLED` | No | `1` in image and image build | Disable Next.js telemetry. |

Compose reads these values from `.env`. They configure compose, not arbitrary app environment overrides.

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `SESSION_SECRET` | Yes | None | Pass the production session secret into the app. |
| `APP_PORT` | No | `5009` | Host port bound only to `127.0.0.1`, forwarded to app port `3000`. |
| `APP_UID` | No | `1000` | Numeric app user id; must own the asset directory. |
| `APP_GID` | No | `1000` | Numeric app group id for asset directory access. |
| `IMAGE_TAG` | No | `latest` | Tag of `ghcr.io/senth/the-game-v4` to deploy. |

## Deploying with compose

Human operators run these commands on the deployment host. Agents never run Docker on fenrir.

```sh
cp .env.example .env
openssl rand -base64 48
```

Put the generated value in `.env` as `SESSION_SECRET`. Keep `.env` out of version control.
Set `APP_UID` and `APP_GID` to the account that will manage assets.
Create storage directories, replacing `1000:1000` below with those configured ids.

```sh
mkdir -p data/assets data/mongo
sudo chown 1000:1000 data/assets data/mongo
docker compose up -d
```

MongoDB initialization manages ownership inside `data/mongo`; the app needs write access to `data/assets`.
Both directories persist across container replacement. Back up both before upgrades or imports.
MongoDB has no host port. The app binds `127.0.0.1:5009` unless `APP_PORT` changes.
The human configures DNS, HTTPS and nginx at `game.senth.org`, including SSE proxy settings.

Create a production admin with the bundled script. Replace `<name>` with the login name.
The command prompts for a password of at least eight characters.

```sh
docker compose exec -it app node scripts/admin-create.mjs <name>
```

### Migrating from v3

On fenrir, confirm Application Default Credentials exist at `~/.config/gcloud/application_default_credentials.json`.
Export season documents as JSON:

```sh
pnpm export:v3 --project <gcp-id> --out .tmp/v3-export.json
```

If the exporter reports an empty collection, rerun with the listed seasons collection:

```sh
pnpm export:v3 --project <gcp-id> --collection <seasons-collection> --out .tmp/v3-export.json
```

Copy `.tmp/v3-export.json` to a secure backup outside the repository. It contains every answer; never commit it.

Optional: archive every other listed root collection before I-33. Repeat for each collection:

```sh
mkdir -p .tmp/v3-archive
pnpm export:v3 --project <gcp-id> --collection <collection> --out .tmp/v3-archive/<collection>.json
```

Dry-run the import and review asset warnings. Fix bucket access or URLs before importing for real:

```sh
docker compose run --rm -v ./.tmp/v3-export.json:/import.json:ro app node scripts/import-v3.mjs /import.json --dry-run
```

Run the real import after resolving warnings:

```sh
docker compose run --rm -v ./.tmp/v3-export.json:/import.json:ro app node scripts/import-v3.mjs /import.json
```

Existing seasons are skipped. Delete a season before retrying its assets.
The importer copies seasons and quests, not teams or users. See [migration rules](docs/PROJECT.md#assets-migration-and-deployment).

## Releasing

Push a `vX.Y.Z` tag for the release commit. The publish workflow builds that tag and pushes these GHCR tags:

- `ghcr.io/senth/the-game-v4:vX.Y.Z`
- `ghcr.io/senth/the-game-v4:X.Y.Z`
- `ghcr.io/senth/the-game-v4:latest`

After the first publish, set the GHCR package visibility to public once so fenrir can pull without `docker login`.
Set `IMAGE_TAG` in the host's `.env` to the desired version, then update:

```sh
docker compose pull app
docker compose up -d
```

PR CI runs application gates and a separate compose image check.
CI checks formatting with `pnpm lint`, without rewriting files.
