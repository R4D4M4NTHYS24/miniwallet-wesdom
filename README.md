# MiniWallet

MiniWallet is a small wallet transfer system built for a technical review. Users can authenticate, inspect their wallet, and send transfers to other users.

Transfers up to `100000` cents are confirmed immediately. Transfers above `100000` cents enter pending admin review. Admins can approve or reject suspicious pending transactions. Ledger entries and audit logs preserve financial traceability across confirmed, pending, approved, and rejected flows.

## Tech Stack

- Node.js / TypeScript / Express
- PostgreSQL
- Prisma
- React / Vite
- Docker Compose
- Vitest / Supertest

## Run Locally

From a fresh checkout with Docker available, start the full local review stack with one command:

```bash
docker compose up -d --build
```

Docker Compose starts PostgreSQL, waits for it to become healthy, runs Prisma migrations with `prisma migrate deploy`, seeds local/demo reviewer accounts, then starts the API and web app.

Expected local URLs:

- API: http://localhost:3000
- Web: http://localhost:5173
- Health check: http://localhost:3000/health
- PostgreSQL: localhost:5432

Docker Compose passes an internal database URL to containers using the `postgres` service hostname. The `.env.example` database URL uses `localhost` for commands run from the host.

`prisma db seed` is for local/demo setup. It creates seeded reviewer users and wallets when missing, but rerunning it is idempotent and does not rewrite existing wallet balances or transaction history.

To reset demo balances and data for a clean review run:

```bash
docker compose down -v
docker compose up -d --build
```

## Host Development And Tests

Install dependencies and create the host-local environment file:

```bash
npm install
cp .env.example .env
```

`npm install` automatically runs `npm run db:generate` to generate Prisma Client from `apps/api/prisma/schema.prisma`. If Prisma Client is missing or stale, rerun it manually:

```bash
npm run db:generate
```

For host-side development or tests, start PostgreSQL, apply development migrations, and seed reviewer accounts from the host:

```bash
docker compose up -d postgres
npm run prisma:migrate
npm run prisma:seed
```

Run the API integration tests from the host:

```bash
npm run test:api
```

The API integration tests use PostgreSQL and mutate the configured `DATABASE_URL`. They are intended only for local, development, or test databases. Do not point the test script at production data.

## Seed Accounts

All seeded users use the local-development password `Password123!`.

- `admin@miniwallet.local` / `Password123!`
- `alice@miniwallet.local` / `Password123!`
- `bob@miniwallet.local` / `Password123!`

Seeded wallet balances on a clean volume:

- Admin: `0` available cents
- Alice: `250000` available cents
- Bob: `100000` available cents

## Reviewer UI Flow

1. Open http://localhost:5173.
2. Use the auth screen to sign in or create a basic user account.
3. Select `View reviewer demo accounts` to view the seeded local credentials.
4. For the transfer and admin demo, log in as Bob and copy Bob's displayed User ID.
5. Log in as Alice.
6. Paste Bob's User ID as recipient.
7. Send `5000` cents to create a confirmed transfer.
8. Send `100001` cents to create a pending-review transfer.
9. Log in as admin.
10. Approve or reject pending transactions from the admin queue.

Newly registered UI users start with a zero-balance user wallet. The seeded accounts remain recommended for the full reviewer flow because they include funded users and an admin user.

## API Quick Reference

- `POST /auth/register`: create a user account.
- `POST /auth/login`: authenticate and receive a bearer token.
- `GET /auth/me`: return the authenticated user.
- `GET /auth/admin-check`: confirm the authenticated user has admin access.
- `GET /wallet/me`: return the authenticated user's wallet balances.
- `POST /transfers`: create a transfer. Send `amountCents` as a string, for example `"5000"`.
- `GET /transactions`: return the authenticated user's transaction history.
- `GET /transactions/:id`: return transaction detail. Admins may access any transaction.
- `GET /admin/suspicious-transactions`: return the admin pending-review queue.
- `POST /admin/transactions/:id/approve`: approve a pending suspicious transaction.
- `POST /admin/transactions/:id/reject`: reject a pending suspicious transaction.
- `GET /health`: return API health status.

Example transfer request:

```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"toUserId":"recipient-user-uuid","amountCents":"5000"}'
```

## Tests

Build the API and web apps, or run the API integration suite:

```bash
npm install
npm run db:generate
cp .env.example .env
npm run build:api
npm run build:web
npm run test:api
```

The integration suite currently contains 11 tests covering core financial flows, including authentication, confirmed transfers, pending-review transfers, admin approval/rejection, history access control, validation failures, rollback behavior, ledger/audit rows, and concurrent transfer protection.

## Design Notes

- `Transaction` represents business state: confirmed, pending review, or rejected.
- `LedgerEntry` represents immutable financial movement.
- `AuditLog` represents the operational/action trail.
- `amountCents` is passed as a string at the API boundary to avoid JavaScript number precision issues with large integer values.
- Money is stored as integer cents.
- Transfers are processed inside database transactions.
- Wallet rows are locked deterministically to avoid race conditions and overspending under concurrent requests.
- Available and pending wallet balances support the admin review flow without crediting recipients before approval.

## Known Limitations

- No refresh-token flow.
- Minimal frontend only, not production-grade UX.
- No email or notification system for admin review.
- No real KYC or fraud engine; the suspicious rule is threshold-based.
- Test script uses a Unix-style environment fallback.
- Single-currency USD only.

## Scaling Notes

- Add a dedicated test database and CI pipeline.
- Use outbox/event processing for audit, reporting, and external integrations.
- Add more fraud rules and risk scoring.
- Add admin review queue filters and search.
- Add idempotency keys for transfer requests.
- Add observability and structured logs.
- Harden production authentication and session management.
