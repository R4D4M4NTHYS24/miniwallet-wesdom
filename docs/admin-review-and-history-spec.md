# Admin Review and Transaction History Specification

## 1. Purpose

Phase 6 exposes transaction history for authenticated users and lets admins review suspicious pending transfers created by the Phase 5 transfer engine.

This phase completes the pending-review lifecycle without adding frontend features, integration tests, background jobs, or external fraud systems.

## 2. Scope

In scope:

- `GET /transactions` with pagination for the authenticated user
- `GET /transactions/:id` for the authenticated user
- `GET /admin/suspicious-transactions` for `ADMIN` users
- `POST /admin/transactions/:id/approve`
- `POST /admin/transactions/:id/reject`
- Ledger and audit entries for approve/reject
- Semantic errors

Out of scope:

- Frontend
- Integration tests
- Background jobs
- External fraud providers
- Partial approvals
- Editing transaction amounts
- Admin review of already confirmed or rejected transactions

## 3. Transaction History API

### GET /transactions?page=1&pageSize=20

Auth required.

Returns transactions where the authenticated user is either sender or recipient, ordered by `createdAt` descending and `id` descending as a deterministic tie-breaker. This endpoint returns own transactions only for all authenticated users, including admins. The admin-wide review queue is `GET /admin/suspicious-transactions`.

Pagination defaults: `page = 1`, `pageSize = 20`. `page` and `pageSize` must be positive integers greater than or equal to `1`. Maximum `pageSize` is `100`. Invalid pagination returns `VALIDATION_ERROR`.

All transaction-returning endpoints must use the safe transaction DTO shape below and serialize `amountCents` as a string. This applies to `GET /transactions`, `GET /transactions/:id`, `GET /admin/suspicious-transactions`, `POST /admin/transactions/:id/approve`, and `POST /admin/transactions/:id/reject`. Responses must not expose `passwordHash`, wallet balances from unrelated users, or unrelated user private data.

Safe transaction DTO:

```json
{
  "id": "uuid",
  "status": "CONFIRMED | PENDING_REVIEW | REJECTED",
  "amountCents": "string",
  "currency": "USD",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "riskReason": "AMOUNT_ABOVE_REVIEW_THRESHOLD | null",
  "confirmedAt": "iso-date | null",
  "reviewedAt": "iso-date | null",
  "reviewedByUserId": "uuid | null",
  "createdAt": "iso-date"
}
```

List response envelope for `GET /transactions`:

```json
{
  "items": [transactionDto],
  "page": 1,
  "pageSize": 20,
  "total": 42
}
```

### GET /transactions/:id

Auth required.

Regular users can access a transaction only if they are the sender or recipient. Admin users can access any transaction through this detail endpoint. Keep this behavior explicit in the implementation.

Use `TRANSACTION_NOT_FOUND` when the transaction does not exist. Use `FORBIDDEN` when a transaction exists but the authenticated user is not allowed to access it.

## 4. Suspicious Transactions API

### GET /admin/suspicious-transactions

Admin only.

Returns suspicious transactions with:

- `status = PENDING_REVIEW`
- `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`

Default order is `createdAt` ascending and `id` ascending as a deterministic tie-breaker, so the oldest pending reviews are handled first. Supports pagination with `page` and `pageSize`.

Pagination defaults: `page = 1`, `pageSize = 20`. `page` and `pageSize` must be positive integers greater than or equal to `1`. Maximum `pageSize` is `100`. Invalid pagination returns `VALIDATION_ERROR`.

List response envelope for `GET /admin/suspicious-transactions`:

```json
{
  "items": [transactionDto],
  "page": 1,
  "pageSize": 20,
  "total": 42
}
```

## 5. Admin Approval Flow

### POST /admin/transactions/:id/approve

Admin only.

Only suspicious pending transactions can be approved. A transaction is reviewable only when `status = PENDING_REVIEW` and `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`; otherwise return `TRANSACTION_NOT_REVIEWABLE`.

Approving a nonexistent transaction returns `TRANSACTION_NOT_FOUND`.

Implementation steps:

1. Validate admin authentication and route params.
2. Open a database transaction.
3. Lock the transaction row with `SELECT ... FOR UPDATE`.
4. Lock involved wallet rows in deterministic order by wallet id.
5. Verify the transaction is still `PENDING_REVIEW` and has `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD` after locks are acquired.
6. Verify transaction currency is `USD`.
7. Verify sender wallet currency is `USD`.
8. Verify recipient wallet currency is `USD`.
9. Return `UNSUPPORTED_CURRENCY` if any required currency is not `USD`; this must happen before any financial writes.
10. Verify sender pending balance is sufficient.
11. Verify recipient available balance will not exceed PostgreSQL `BIGINT` max.
12. Update sender `pendingBalanceCents -= amountCents`.
13. Update recipient `availableBalanceCents += amountCents`.
14. Update `Transaction` to `CONFIRMED`, setting `reviewedByUserId`, `reviewedAt`, and `confirmedAt`.
15. Create `LedgerEntry` rows:
    - Sender wallet: `DEBIT`, `PENDING`, `RELEASE`, `amountCents`
    - Recipient wallet: `CREDIT`, `AVAILABLE`, `TRANSFER_IN`, `amountCents`
16. Create `AuditLog` row with action `TRANSFER_APPROVED`.
17. Commit.
18. Return transaction DTO with `amountCents` as a string.

## 6. Admin Rejection Flow

### POST /admin/transactions/:id/reject

Admin only.

Only suspicious pending transactions can be rejected. A transaction is reviewable only when `status = PENDING_REVIEW` and `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`; otherwise return `TRANSACTION_NOT_REVIEWABLE`.

Implementation steps:

1. Validate admin authentication and route params.
2. Open a database transaction.
3. Lock the transaction row with `SELECT ... FOR UPDATE`.
4. Lock involved wallet rows in deterministic order by wallet id.
5. Verify the transaction is still `PENDING_REVIEW` and has `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD` after locks are acquired.
6. Verify transaction currency is `USD`.
7. Verify sender wallet currency is `USD`.
8. Verify recipient wallet currency is `USD`; recipient wallet is checked even though rejection only mutates sender balances because the transaction references both wallets and MiniWallet keeps USD-only financial invariants.
9. Return `UNSUPPORTED_CURRENCY` if any required currency is not `USD`; this must happen before any financial writes.
10. Verify sender pending balance is sufficient.
11. Verify sender available balance will not exceed PostgreSQL `BIGINT` max.
12. Update sender `pendingBalanceCents -= amountCents`.
13. Update sender `availableBalanceCents += amountCents`.
14. Update `Transaction` to `REJECTED`, setting `reviewedByUserId` and `reviewedAt`; `confirmedAt` remains `null`.
15. Create `LedgerEntry` rows:
    - Sender wallet: `DEBIT`, `PENDING`, `REVERSAL`, `amountCents`
    - Sender wallet: `CREDIT`, `AVAILABLE`, `REVERSAL`, `amountCents`
16. Create `AuditLog` row with action `TRANSFER_REJECTED`.
17. Commit.
18. Return transaction DTO with `amountCents` as a string.

Rejecting a nonexistent transaction returns `TRANSACTION_NOT_FOUND`.

If two admins try to review the same pending transaction concurrently, one request should succeed. The losing request observes the locked/updated transaction as no longer reviewable and receives `TRANSACTION_NOT_REVIEWABLE`.

## 7. Semantic Errors

Use the existing error response shape:

```json
{
  "code": "ERROR_CODE",
  "message": "...",
  "details": {}
}
```

| Code | When to return |
| --- | --- |
| `UNAUTHORIZED` | Bearer JWT is missing, invalid, expired, or references a user that no longer exists. |
| `FORBIDDEN` | Authenticated user lacks access to a transaction or admin endpoint. |
| `VALIDATION_ERROR` | Query params, route params, or body values are invalid. |
| `TRANSACTION_NOT_FOUND` | Requested transaction does not exist. |
| `TRANSACTION_NOT_REVIEWABLE` | Transaction is not currently `PENDING_REVIEW` with `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`. |
| `INSUFFICIENT_PENDING_FUNDS` | Sender pending balance is lower than the transaction amount after locks are acquired. |
| `UNSUPPORTED_CURRENCY` | Transaction or wallet currency required for review does not use `USD`. |
| `BALANCE_LIMIT_EXCEEDED` | Applying the review action would cause a resulting wallet balance to exceed PostgreSQL `BIGINT` max. |
| `INTERNAL_ERROR` | Unexpected server or database failure not covered by a semantic error. |

Expected HTTP status mapping:

| Status | Error or response |
| --- | --- |
| `200 OK` | Successful `GET`, approve, and reject responses. |
| `400 Bad Request` | `VALIDATION_ERROR` |
| `401 Unauthorized` | `UNAUTHORIZED` |
| `403 Forbidden` | `FORBIDDEN` |
| `404 Not Found` | `TRANSACTION_NOT_FOUND` |
| `409 Conflict` | `TRANSACTION_NOT_REVIEWABLE`, `INSUFFICIENT_PENDING_FUNDS`, `UNSUPPORTED_CURRENCY`, `BALANCE_LIMIT_EXCEEDED` |
| `500 Internal Server Error` | `INTERNAL_ERROR` |

## 8. Ledger and Audit Expectations

Approval ledger rows:

| Wallet | Direction | Balance type | Entry type | Amount |
| --- | --- | --- | --- | --- |
| Sender | `DEBIT` | `PENDING` | `RELEASE` | `amountCents` |
| Recipient | `CREDIT` | `AVAILABLE` | `TRANSFER_IN` | `amountCents` |

Rejection ledger rows:

| Wallet | Direction | Balance type | Entry type | Amount |
| --- | --- | --- | --- | --- |
| Sender | `DEBIT` | `PENDING` | `REVERSAL` | `amountCents` |
| Sender | `CREDIT` | `AVAILABLE` | `REVERSAL` | `amountCents` |

Each `LedgerEntry` must reference the reviewed `Transaction` and affected `Wallet`.

Audit actions:

- `TRANSFER_APPROVED`
- `TRANSFER_REJECTED`

Audit metadata must serialize `amountCents` as a string and include:

- `amountCents`
- `currency`
- `fromUserId`
- `toUserId`
- `fromWalletId`
- `toWalletId`
- `reviewedByUserId`
- `previousStatus`
- `newStatus`
- `riskReason`

## 9. Acceptance Criteria for Phase 6

- `npm run build:api` passes.
- `docker compose up --build` works.
- Authenticated user can list own transactions.
- User cannot see unrelated transactions.
- Admin can list suspicious pending transactions.
- Non-admin gets `FORBIDDEN` for admin endpoints.
- Approving a pending transfer updates balances correctly.
- Rejecting a pending transfer releases funds correctly.
- Approve/reject create correct ledger and audit rows.
- Approving or rejecting a non-pending transaction returns `TRANSACTION_NOT_REVIEWABLE`.
- Failed admin review leaves balances unchanged and creates no partial ledger or audit rows.
- No frontend or integration tests are implemented in Phase 6.

## 10. Manual Validation Plan

Before Phase 7 automated tests exist, manually validate:

- Pending transaction fields before review.
- Sender and recipient balances before and after approval.
- Sender balances before and after rejection.
- Exact approval/rejection `LedgerEntry` row count and fields.
- `AuditLog` action, references, and metadata serialization.
- Invalid pagination returns `VALIDATION_ERROR`.
- `pageSize > 100` returns `VALIDATION_ERROR`.
- Non-integer pagination returns `VALIDATION_ERROR`.
- Non-admin access to admin endpoints returns `FORBIDDEN`.
- Unrelated transaction access returns `FORBIDDEN`.
- Admin `GET /transactions` returns own transactions only, while `GET /admin/suspicious-transactions` returns the admin review queue.
- Approving or rejecting a nonexistent transaction returns `TRANSACTION_NOT_FOUND`.
- Approving or rejecting a confirmed/rejected transaction returns `TRANSACTION_NOT_REVIEWABLE`.
- Unsupported currency returns `UNSUPPORTED_CURRENCY`.
- Insufficient pending funds returns `INSUFFICIENT_PENDING_FUNDS`.
- Balance overflow returns `BALANCE_LIMIT_EXCEEDED`.
- Concurrent double-review behavior: one review succeeds, and the losing request returns `TRANSACTION_NOT_REVIEWABLE`.
