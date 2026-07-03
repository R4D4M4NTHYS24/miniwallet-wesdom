# MiniWallet

MiniWallet is a fintech-oriented wallet technical test. This repository is currently at Phase 2: Docker Compose plus minimal API/web skeleton.

No authentication, Prisma schema, wallet logic, transfer logic, ledger logic, admin review, transaction history, or integration tests are implemented yet.

## Run Phase 2 Skeleton

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

Copy `.env.example` to `.env` if you want to override local defaults used by Docker Compose.

`DATABASE_URL` in `.env.example` uses `localhost` for host-local tools. Docker Compose passes an internal database URL to the API container that uses the `postgres` service hostname.

`JWT_SECRET` is reserved for Phase 4 authentication and is not used by the Phase 2 skeleton yet.
