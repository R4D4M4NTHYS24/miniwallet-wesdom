# MiniWallet

MiniWallet is a fintech-oriented wallet technical test. This repository is currently at Phase 4: authentication, validation, middleware, and semantic errors.

No transfer execution logic, admin review behavior, transaction history endpoints, frontend features, or integration tests are implemented yet.

## Run Locally

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

Seeded passwords are placeholder hashes only. Create a user through `POST /auth/register` for local login checks.
