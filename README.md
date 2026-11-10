# LoTUS-BF

LoTUS-BF is a React/Vite frontend served by a Flask API. The API searches a PostgreSQL database containing the Neurosynth metadata, term annotations, and coordinates. The database is separate from the SQLite database used for user accounts and saved literature notes.

## Project data

The source Parquet files are in `data/`:

- `metadata.parquet`
- `annotations.parquet`
- `coordinates.parquet`

`create_db.py` imports these files into the `ns` PostgreSQL schema. The application reads `DATABASE_URL` (or `DB_URL`) at runtime. The import script uses `pandas` and `pyarrow`; both are included in `requirements.txt`.

## Run locally

Install the frontend and backend dependencies:

```bash
npm ci
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create or select a PostgreSQL database with PostGIS available. Set its connection string and import the data once:

```bash
export DB_URL='postgresql://USER:PASSWORD@HOST:5432/DATABASE'
python create_db.py --url "$DB_URL" --data-dir ./data --enable-json
```

The import command defaults to replacing the existing `ns.coordinates` and `ns.metadata` tables. Run it only when initializing or intentionally rebuilding the database. `--enable-json` creates `ns.annotations_json`, which the term search endpoints require.

In one terminal, start Flask:

```bash
flask --app app run --host 0.0.0.0 --port 5000
```

In another terminal, start Vite:

```bash
npm run dev
```

Vite proxies API requests to Flask on `127.0.0.1:5000`.

## Deploy on Render

The included `Dockerfile` builds the React frontend, installs Flask and the Parquet import dependencies, and starts the app with Gunicorn. In Render, create a PostgreSQL database and a Docker Web Service for this repository. Set the Web Service's `DATABASE_URL` to the database's **Internal Database URL** and set:

```text
LOTUS_SECRET_KEY=<long random secret>
LOTUS_COOKIE_SECURE=1
LOTUS_APP_DB_PATH=/var/data/lotus_workspace.sqlite3
```

Set the Web Service health check path to `/healthz`. The server listens on Render's `PORT` environment variable (defaulting to `10000` locally).

Initialize the Render database once with the Parquet files. From a computer that can reach the database, use the database's **External Database URL**:

```bash
export DB_URL='postgresql://USER:PASSWORD@EXTERNAL_HOST:5432/DATABASE'
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python create_db.py --url "$DB_URL" --data-dir ./data --enable-json
```

Do not run the import on every deploy: its default behavior replaces tables. Once the import completes, the deployed app uses the Internal Database URL.

The SQLite workspace database stores accounts, groups, notes, and the session key. Attach a persistent disk to the Web Service at `/var/data` to preserve those records across restarts and deployments. Without a persistent disk, the app still runs, but server-side account/workspace data can be lost when the instance is replaced. Guest data remains in the visitor's browser.

## Accounts and literature workspace

Registration is self-service. Passwords are hashed on the server. Signed-in users' paper notes, groups, and workspace state are private to their account; guest groups and notes stay in that browser's local storage. Keep `LOTUS_SECRET_KEY` stable across restarts, and use HTTPS for accounts in production.

## Useful endpoints

- `/healthz` — app and database connectivity check
- `/help` — API syntax and endpoint information
- `/terms` — available terms
- `/query/<query>/studies` — matching studies
- `/query/<query>/locations` — matching coordinates
- `/query/<query>/nii` — generated NIfTI map
