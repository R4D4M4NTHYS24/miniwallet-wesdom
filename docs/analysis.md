# MiniWallet Architecture Analysis

## Problem summary

MiniWallet is a fintech-oriented wallet system where registered users can transfer balance to each other, consult transaction history, and support admin review for suspicious transfers. The main correctness requirement is that money is never lost or duplicated, including under concurrent transfer requests.

## Scope

The scope is a minimal full-stack technical test with JWT authentication, atomic wallet transfers, transaction history with pagination, admin suspicious transaction review, Docker Compose infrastructure, integration tests, and architecture documentation.

## Assumptions

- The only supported currency is USD.
- Money is stored and processed as integer cents.
- The API accepts `amountCents` rather than decimal dollar values.
- Transfers above `100000` cents require admin review.
- Users have one wallet each.
- Admin users are identified by a role in the user model.
- External payment rails, KYC, notifications, and advanced fraud detection are out of scope.

## Chosen stack

- API: Node.js, TypeScript, Express.
- Database: PostgreSQL.
- ORM: Prisma, with raw SQL only where needed for `SELECT ... FOR UPDATE` locks.
- Validation: Zod.
- Tests: Vitest and Supertest.
- Frontend: React, Vite, TypeScript.
- Infrastructure: Docker Compose.

## Core domain model

- `User`: registered actor with authentication data and role.
- `Wallet`: current balance state for a user.
- `Transaction`: business record for a transfer and its lifecycle state.
- `LedgerEntry`: immutable financial movement linked to a transaction.
- `AuditLog`: action/event record for operational auditability.

## Financial model

Money fields use integer cents and explicit names:

- `amountCents`
- `availableBalanceCents`
- `pendingBalanceCents`

Wallet balances are updated only inside database transactions. Every successful balance mutation must have matching `LedgerEntry` records and an `AuditLog` event.

## Transaction states

- `CONFIRMED`: the transfer is final and receiver funds are available.
- `PENDING_REVIEW`: the sender funds are reserved pending admin review.
- `REJECTED`: the reviewed transfer was rejected and reserved funds were returned.

## Allowed state transitions

- Immediate transfer: create as `CONFIRMED` when `amountCents <= 100000`.
- High-value transfer: create as `PENDING_REVIEW` when `amountCents > 100000`.
- Admin approval: `PENDING_REVIEW -> CONFIRMED`.
- Admin rejection: `PENDING_REVIEW -> REJECTED`.

## Invalid state transitions

- `CONFIRMED -> PENDING_REVIEW`.
- `CONFIRMED -> REJECTED`.
- `REJECTED -> CONFIRMED`.
- `REJECTED -> PENDING_REVIEW`.
- Approving or rejecting a transaction that is not `PENDING_REVIEW`.
- Creating a pending transaction without reserving sender funds.
- Confirming a pending transaction without consuming sender pending balance exactly once.

## Available balance vs pending balance

`availableBalanceCents` is spendable money. `pendingBalanceCents` is reserved money that belongs to the sender but cannot be spent while a transfer is under review.

For transfers above `100000` cents, funds move from sender available balance to sender pending balance. The receiver does not receive funds until admin approval. On rejection, pending funds return to the sender available balance.

## Transfer flow for `amountCents <= 100000`

1. Authenticate the user with JWT.
2. Validate request body with Zod.
3. Reject invalid amount, missing receiver, same sender/receiver, or insufficient funds with semantic errors.
4. Start a PostgreSQL transaction.
5. Lock sender and receiver wallet rows in deterministic order.
6. Re-check sender `availableBalanceCents >= amountCents` after locks are acquired.
7. Decrease sender `availableBalanceCents`.
8. Increase receiver `availableBalanceCents`.
9. Create `Transaction` with `status = CONFIRMED`.
10. Create immutable `LedgerEntry` rows for sender debit and receiver credit.
11. Create an `AuditLog` event.
12. Commit and return `201 Created`.

## Transfer flow for `amountCents > 100000`

1. Authenticate the user with JWT.
2. Validate request body with Zod.
3. Reject invalid amount, missing receiver, same sender/receiver, or insufficient funds with semantic errors.
4. Start a PostgreSQL transaction.
5. Lock the sender wallet row.
6. Re-check sender `availableBalanceCents >= amountCents` after the lock is acquired.
7. Move funds from sender `availableBalanceCents` to sender `pendingBalanceCents`.
8. Create `Transaction` with `status = PENDING_REVIEW` and `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`.
9. Create immutable `LedgerEntry` rows for available debit and pending credit.
10. Create an `AuditLog` event.
11. Commit and return `201 Created` with `status = PENDING_REVIEW`.

## Admin approval flow

1. Authenticate an admin user.
2. Start a PostgreSQL transaction.
3. Lock the transaction row with `SELECT ... FOR UPDATE`.
4. Verify the transaction is `PENDING_REVIEW`.
5. Lock sender and receiver wallet rows in deterministic order.
6. Move funds from sender `pendingBalanceCents` to receiver `availableBalanceCents`.
7. Update transaction status to `CONFIRMED` and set review metadata.
8. Create immutable `LedgerEntry` rows for sender pending debit and receiver available credit.
9. Create an `AuditLog` event.
10. Commit and return the updated transaction.

## Admin rejection flow

1. Authenticate an admin user.
2. Start a PostgreSQL transaction.
3. Lock the transaction row with `SELECT ... FOR UPDATE`.
4. Verify the transaction is `PENDING_REVIEW`.
5. Lock the sender wallet row.
6. Move funds from sender `pendingBalanceCents` back to sender `availableBalanceCents`.
7. Update transaction status to `REJECTED` and set review metadata.
8. Create immutable `LedgerEntry` rows for pending debit and available credit.
9. Create an `AuditLog` event.
10. Commit and return the updated transaction.

## Suspicious transaction definition

A suspicious transaction is any transfer with `amountCents > 100000`. It is created with:

- `status = PENDING_REVIEW`
- `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`

The admin list endpoint returns pending or risk-flagged transactions.

## Atomicity and concurrency strategy

- All balance-changing operations run inside PostgreSQL transactions.
- Balance checks happen after acquiring row-level locks.
- Wallet rows are locked before mutation.
- Transaction rows are locked during admin approval/rejection.
- Wallet locks use deterministic ordering when more than one wallet is involved.
- Ledger entries, transaction state changes, balance mutations, and audit logs are committed atomically.

## Row-level locking strategy

Prisma is used for normal database access. Raw SQL is used only for lock acquisition with `SELECT ... FOR UPDATE`.

Locking rules:

- Immediate transfer: lock sender and receiver wallets.
- Pending review creation: lock sender wallet.
- Approval: lock transaction, sender wallet, and receiver wallet.
- Rejection: lock transaction and sender wallet.

This prevents overspending, lost updates, double approvals, and double rejections.

## LedgerEntry strategy

`LedgerEntry` records immutable financial movements. It is not used as an operational event log; it explains how money moved between balance buckets and wallets.

Examples:

- Confirmed transfer: sender available debit, receiver available credit.
- Pending transfer creation: sender available debit, sender pending credit.
- Approval: sender pending debit, receiver available credit.
- Rejection: sender pending debit, sender available credit.

## AuditLog strategy

`AuditLog` records actions/events such as transfer creation, admin approval, and admin rejection. It includes actor, action, entity reference, metadata, and timestamp. It complements `LedgerEntry` but does not replace financial ledger records.

## Semantic error strategy

Errors should be predictable and use semantic HTTP status codes with stable error codes.

Examples:

- `400 VALIDATION_ERROR`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 USER_NOT_FOUND`
- `404 TRANSACTION_NOT_FOUND`
- `409 INSUFFICIENT_FUNDS`
- `409 INVALID_TRANSACTION_STATE`
- `422 SAME_SENDER_RECEIVER`

## Integration test strategy

Core integration tests should cover:

- Register/login users and execute a confirmed transfer.
- Verify sender and receiver balances after confirmed transfer.
- Verify transaction history pagination includes the transfer.
- Create a high-value transfer and verify `PENDING_REVIEW`, `riskReason`, and pending balance reservation.
- Admin approve pending transfer and verify final balances/state.
- Admin reject pending transfer and verify funds are released.
- Concurrent transfers from the same wallet cannot overspend or create negative balances.
- Non-admin users cannot access admin review endpoints.

## Known risks and mitigations

- Concurrent overspending: mitigate with row-level locks and post-lock balance checks.
- Double admin review: mitigate by locking transaction rows and validating `PENDING_REVIEW` state.
- Money precision errors: mitigate by using integer cents only.
- Audit ambiguity: mitigate by separating `Transaction`, `LedgerEntry`, and `AuditLog` responsibilities.
- Deadlocks: mitigate with deterministic wallet lock ordering.
- Scope creep: mitigate by keeping fraud detection, multiple currencies, refresh tokens, and external integrations out of scope.

## Scope control

The implementation prioritizes backend correctness, reproducible local execution, tests, and documentation. The frontend remains minimal and exists to demonstrate basic web interaction with the API. Advanced fintech features such as multi-currency, chargebacks, KYC, notifications, background jobs, and external payment providers are intentionally excluded.
