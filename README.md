# MiniWallet

MiniWallet is a fintech-oriented wallet technical test. This repository is currently at Phase 3: database schema, Prisma migrations, and seed data.

No authentication flows, transfer execution logic, admin review behavior, transaction history endpoints, frontend features, or integration tests are implemented yet.

## Run Current Skeleton

```bash
docker compose up --build
```

Expected local URLs:

- API health endpoint: http://localhost:3000/health
- Web app: http://localhost:5173
- PostgreSQL: localhost:5432

The API health endpoint returns JSON confirming the Express service is running:

```json
{
  "status": "ok",
  "service": "miniwallet-api",
  "phase": "skeleton"
}
```

## Local Environment

Copy `.env.example` to `.env` before running host-local Prisma commands:

```bash
cp .env.example .env
```

`DATABASE_URL` in `.env.example` uses `localhost` for host-local Prisma commands. Docker Compose explicitly passes an internal database URL to the API container that uses the `postgres` service hostname.

`JWT_SECRET` is reserved for Phase 4 authentication and is not used by the Phase 3 skeleton yet.

## Database Setup

Start PostgreSQL:

```bash
docker compose up -d postgres
```

Generate the Prisma client:

```bash
npm run prisma:generate
```

Apply migrations:

```bash
npm run prisma:migrate
```

Seed predictable local users and wallets:

```bash
npm run prisma:seed
```

Seeded users:

- `admin@miniwallet.local`: admin user with `0` available cents.
- `alice@miniwallet.local`: regular user with `250000` available cents.
- `bob@miniwallet.local`: regular user with `100000` available cents.

Seeded passwords are placeholder hashes only. Login/auth behavior is planned for Phase 4 and is not implemented yet.
