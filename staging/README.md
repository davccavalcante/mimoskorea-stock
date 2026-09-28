# Staging store (local test environment)

A disposable WordPress + WooCommerce + MariaDB store on `http://localhost:8080`,
seeded with a mirror of the production catalogue (categories, brands and the 103
published products from the audit snapshot, including the real duplicates).
The studio is tested against it before touching the real store.

## Requirements

- Docker with Compose v2
- `curl`, `python3`

## Start

```bash
cd staging
./setup.sh             # create or update
./setup.sh --reset     # wipe everything and start again
```

The script:

1. downloads the latest WooCommerce release zip from GitHub (no wordpress.org access needed),
2. starts MariaDB 11 + WordPress (latest) and installs WooCommerce with WP-CLI,
3. sets BRL, kg/cm units, stock management and pretty permalinks,
4. creates an Application Password (saved in `.cache/app-password.txt`, outside the web root),
5. seeds the catalogue mirror with `seed_from_snapshot.py`,
6. writes `../studio/.env.local` in test mode (mock AI + this store), unless you already have your own `.env.local`.

wp-admin: `http://localhost:8080/wp-admin` (user `admin`, password `admin-staging-only`).

If Docker Hub rate-limits image pulls, use a mirror:

```bash
DB_IMAGE=mirror.gcr.io/library/mariadb:11 CLI_IMAGE=mirror.gcr.io/library/wordpress:cli ./setup.sh
```

## Stop

```bash
docker compose down        # keep data
docker compose down -v     # delete data
```
