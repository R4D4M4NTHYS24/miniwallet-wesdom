# MiniWallet

MiniWallet is a fintech-oriented wallet technical test. This repository is currently at Phase 8: a minimal reviewable web UI over the existing wallet API.

The API covers auth, wallet summary, transfers, transaction history, admin review, ledger, audit, and concurrency flows. The web app demonstrates the core reviewer flow without adding wallet mutations beyond the existing transfer and admin review endpoints.

## Run Locally

```bash
docker compose up -d --build api web postgres
```

If the database has not been migrated yet, run:

```bash
npm run prisma:migrate
```

Expected local URLs:

- API: http://localhost:3000
- API health endpoint: http://localhost:3000/health
- Web app: http://localhost:5173
- PostgreSQL: localhost:5432

The API health endpoint returns JSON confirming the Express service is running:

```json
{
  "status": "ok",
  "service": "miniwallet-api",
  "phase": "phase-8-minimal-ui"
}
```

## Web Review Flow

Seed credentials:

- `admin@miniwallet.local` / `Password123!`
- `alice@miniwallet.local` / `Password123!`
- `bob@miniwallet.local` / `Password123!`

Reviewer flow:

1. Open http://localhost:5173.
2. Log in as Bob and copy Bob's displayed User ID.
3. Log in as Alice.
4. Paste Bob's User ID as the recipient.
5. Send `5000` cents for a confirmed transfer.
6. Send `100001` cents for a pending-review transfer.
7. Log in as admin.
8. Approve or reject pending transactions from the admin queue.

## Local Environment

Copy `.env.example` to `.env` before running host-local Prisma commands:

```bash
cp .env.example .env
```

`DATABASE_URL` in `.env.example` uses `localhost` for host-local Prisma commands. Docker Compose explicitly passes an internal database URL to the API container that uses the `postgres` service hostname.

`JWT_SECRET` is used to sign authentication tokens. Docker Compose provides a local-development fallback value.

For production-like environments, JWT_SECRET must be provided explicitly. The local fallback is only intended for Docker Compose/local development.

## Auth Endpoints

Register a user:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"new-user@example.com","password":"Password123!"}'
```

Log in:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"new-user@example.com","password":"Password123!"}'
```

Validate a token:

```bash
curl http://localhost:3000/auth/me \
  -H 'Authorization: Bearer <token>'
```

## Transfer Endpoint

Create a transfer:

```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"toUserId":"recipient-user-uuid","amountCents":"5000"}'
```

`amountCents` must be sent as a string for BigInt-safe parsing and serialization.

## History And Admin Review

- `GET /transactions`: authenticated user's own transaction history.
- `GET /transactions/:id`: transaction detail, with admin detail access allowed.
- `GET /admin/suspicious-transactions`: admin pending-review queue.
- `POST /admin/transactions/:id/approve`: approve a pending suspicious transfer.
- `POST /admin/transactions/:id/reject`: reject a pending suspicious transfer.

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

Seeded users share the local-development password `Password123!`.

## API Integration Tests

Start PostgreSQL, apply migrations, then run the API integration tests:

```bash
docker compose up -d postgres
npm run prisma:migrate
npm run test:api
```

`npm run test:api` runs against PostgreSQL using `DATABASE_URL` when provided; otherwise it uses the local Docker Compose fallback database URL. The tests mutate the target database and are intended only for local, development, or test databases, not production.

The test suite creates isolated prefixed data and cleans up its own test data.
