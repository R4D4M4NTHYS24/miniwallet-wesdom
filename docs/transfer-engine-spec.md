# Transfer Engine Specification

## 1. Purpose

This specification defines the expected behavior for Phase 5 atomic transfer creation in MiniWallet. It is intended to be practical and implementation-ready for `POST /transfers`, while preparing the rules that Phase 6 admin review and Phase 7 integration/concurrency tests must verify.

Phase 5 must create transfers safely, update wallet balances atomically, write ledger entries for financial movements, and write audit logs for transfer creation. It must not implement admin review, transaction history, frontend behavior, or integration tests yet.

## 2. Scope

In scope for Phase 5:

- `POST /transfers`
- Authenticated sender from the Bearer JWT
- Recipient lookup by `toUserId`
- `amountCents` validation
- Confirmed transfer flow
- Pending-review transfer flow
- PostgreSQL database transaction
- Row-level wallet locks
- `LedgerEntry` creation
- `AuditLog` creation
- Semantic errors

Out of scope for Phase 5:

- Admin approve/reject implementation
- Transaction history endpoints
- Frontend implementation
- Integration tests
- Background jobs
- Multi-currency
- Refunds/chargebacks
- External payment rails

## 3. API Contract

### POST /transfers

Auth: Bearer JWT required.

Request body:

```json
{
  "toUserId": "uuid",
  "amountCents": "5000"
}
```

Clients must send `amountCents` as a base-10 positive integer string. The API must reject JSON numbers for `amountCents` to avoid unsafe JavaScript number rounding. The API parses `amountCents` into `BigInt` only after validation.

`amountCents` must be:

- Positive
- Integer only
- No decimal points
- No commas or currency symbols
- Within PostgreSQL `BIGINT` range: `<= 9223372036854775807`

Response for a confirmed transfer:

```json
{
  "transaction": {
    "id": "uuid",
    "status": "CONFIRMED",
    "amountCents": "5000",
    "currency": "USD",
    "fromUserId": "uuid",
    "toUserId": "uuid",
    "confirmedAt": "iso-date",
    "riskReason": null
  }
}
```

Response for a pending-review transfer:

```json
{
  "transaction": {
    "id": "uuid",
    "status": "PENDING_REVIEW",
    "amountCents": "150000",
    "currency": "USD",
    "fromUserId": "uuid",
    "toUserId": "uuid",
    "confirmedAt": null,
    "riskReason": "AMOUNT_ABOVE_REVIEW_THRESHOLD"
  }
}
```

`amountCents` is stored as `BigInt` in the database. API responses must serialize BigInt cents explicitly as strings to avoid JSON serialization errors and precision ambiguity.

## 4. Financial Invariants

- `amountCents` must be a positive integer.
- Currency is always `USD`; Phase 5 should verify both sender and recipient wallets use `USD` before proceeding, even though the database currently has USD constraints.
- Sender and recipient must be different users.
- Sender and recipient wallets must be different wallets.
- `availableBalanceCents` must never go negative.
- `pendingBalanceCents` must never go negative.
- No money may be created or lost.
- Confirmed transfers move value from sender available balance to recipient available balance.
- Pending-review transfers move value from sender available balance to sender pending balance.
- Recipient does not receive available funds until future admin approval.
- Every financial movement must have `LedgerEntry` rows.
- Every transfer creation must have an `AuditLog` row.
- If any step fails, the whole database transaction must roll back.

## 5. Threshold Rule

| Condition | Transaction status | Risk reason |
| --- | --- | --- |
| `amountCents <= 100000` | `CONFIRMED` | `null` |
| `amountCents > 100000` | `PENDING_REVIEW` | `AMOUNT_ABOVE_REVIEW_THRESHOLD` |

Exactly `100000` cents is confirmed immediately.

## 6. Confirmed Transfer Flow

1. Authenticate sender.
2. Validate request body.
3. Reject self-transfer.
4. Open a database transaction.
5. Find sender wallet and recipient wallet inside the transaction.
6. Lock both wallet rows using `SELECT ... FOR UPDATE`.
7. Use deterministic lock ordering by wallet id to reduce deadlock risk.
8. Verify both locked wallets use `USD`.
9. Verify sender available balance after locks are acquired.
10. Verify `recipient.availableBalanceCents + amountCents` does not exceed PostgreSQL `BIGINT` max value.
11. Create `Transaction` with `CONFIRMED` status and `confirmedAt` set.
12. Update sender `availableBalanceCents -= amountCents`.
13. Update recipient `availableBalanceCents += amountCents`.
14. Create `LedgerEntry` rows:
    - Sender wallet: `DEBIT`, `AVAILABLE`, `TRANSFER_OUT`, `amountCents`
    - Recipient wallet: `CREDIT`, `AVAILABLE`, `TRANSFER_IN`, `amountCents`
15. Create `AuditLog` row with action `TRANSFER_CONFIRMED`.
16. Commit.
17. Return transaction DTO.

## 7. Pending-Review Transfer Flow

1. Authenticate sender.
2. Validate request body.
3. Reject self-transfer.
4. Open a database transaction.
5. Find sender wallet and recipient wallet inside the transaction.
6. Lock both wallet rows using `SELECT ... FOR UPDATE`.
7. Use deterministic lock ordering by wallet id.
8. Verify both locked wallets use `USD`.
9. Verify sender available balance after locks are acquired.
10. Verify `sender.pendingBalanceCents + amountCents` does not exceed PostgreSQL `BIGINT` max value.
11. Create `Transaction` with `PENDING_REVIEW` status and `AMOUNT_ABOVE_REVIEW_THRESHOLD` risk reason.
12. Update sender `availableBalanceCents -= amountCents`.
13. Update sender `pendingBalanceCents += amountCents`.
14. Do not credit recipient available balance yet.
15. Create `LedgerEntry` rows:
    - Sender wallet: `DEBIT`, `AVAILABLE`, `HOLD`, `amountCents`
    - Sender wallet: `CREDIT`, `PENDING`, `HOLD`, `amountCents`
16. Create `AuditLog` row with action `TRANSFER_PENDING_REVIEW`.
17. Commit.
18. Return transaction DTO.

## 8. Locking Strategy

Financial updates must run inside a PostgreSQL transaction. Wallet lookup and row locking must happen inside that transaction. Both sender and recipient wallet rows must be locked before currency checks, balance checks, transaction creation, ledger creation, audit log creation, or balance updates. No financial writes happen before both wallet locks are acquired.

Locks must be acquired in deterministic order by wallet id, not request direction, to reduce deadlock risk for simultaneous A-to-B and B-to-A transfers. Balance checks must happen after locks are acquired so concurrent transfers cannot overspend the same available balance.

Prisma can be used for most create and update operations. Raw SQL is acceptable for `SELECT ... FOR UPDATE` because Prisma does not expose row-level lock syntax directly.

Phase 5 does not implement retry logic. Unexpected deadlock, serialization, or database failures may map to `INTERNAL_ERROR`. Phase 7 may later test or discuss retry behavior if needed.

## 9. Semantic Errors

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
| `VALIDATION_ERROR` | Request body is malformed, `toUserId` is not a UUID, `amountCents` is missing, `amountCents` is not a string, `amountCents` is not a positive integer string, or `amountCents` exceeds PostgreSQL `BIGINT` range. |
| `UNAUTHORIZED` | Bearer JWT is missing, invalid, expired, or references a user that no longer exists. |
| `SENDER_WALLET_NOT_FOUND` | Authenticated sender does not have a wallet. |
| `RECIPIENT_NOT_FOUND` | `toUserId` does not exist or does not have a wallet. |
| `SELF_TRANSFER_NOT_ALLOWED` | Authenticated sender attempts to transfer to their own user id or wallet. |
| `UNSUPPORTED_CURRENCY` | Either locked wallet does not use `USD`; check this after both wallet rows are locked and before any financial writes. |
| `INSUFFICIENT_FUNDS` | Sender available balance is lower than `amountCents` after wallet locks are acquired. |
| `BALANCE_LIMIT_EXCEEDED` | Applying the transfer would cause any resulting wallet balance to exceed PostgreSQL `BIGINT` max value; Phase 5 must validate resulting balances before update statements. |
| `INTERNAL_ERROR` | Unexpected server or database failure not covered by a semantic error. |

## 10. Ledger Expectations

Confirmed transfer ledger rows:

| Wallet | Direction | Balance type | Entry type | Amount |
| --- | --- | --- | --- | --- |
| Sender | `DEBIT` | `AVAILABLE` | `TRANSFER_OUT` | `amountCents` |
| Recipient | `CREDIT` | `AVAILABLE` | `TRANSFER_IN` | `amountCents` |

Pending-review transfer ledger rows:

| Wallet | Direction | Balance type | Entry type | Amount |
| --- | --- | --- | --- | --- |
| Sender | `DEBIT` | `AVAILABLE` | `HOLD` | `amountCents` |
| Sender | `CREDIT` | `PENDING` | `HOLD` | `amountCents` |

Each `LedgerEntry` must reference the created `Transaction` and the affected `Wallet`. `LedgerEntry` rows are immutable. They explain financial mutations but do not replace wallet balances. Wallet balances are the current state; `LedgerEntry` is the audit trail of financial movements.

## 11. Audit Expectations

Expected `AuditLog` actions:

- `TRANSFER_CONFIRMED`
- `TRANSFER_PENDING_REVIEW`

Required `AuditLog` fields:

- `actorUserId`: authenticated sender user id
- `action`: `TRANSFER_CONFIRMED` or `TRANSFER_PENDING_REVIEW`
- `entityType`: `"Transaction"`
- `entityId`: created transaction id
- `transactionId`: created transaction id
- `metadata`: transfer metadata

Required metadata for Phase 5 transfer creation:

- `amountCents` as a string, not `BigInt`
- `currency`
- `fromUserId`
- `toUserId`
- `fromWalletId`
- `toWalletId`
- `status`
- `riskReason` when applicable

All BigInt-like values in `metadata` should be serialized as strings because Prisma JSON cannot store raw JavaScript `bigint` values.

## 12. Concurrency Test Cases Prepared for Phase 7

This specification enables these future Phase 7 tests:

- Two concurrent transfers from the same sender cannot overspend.
- Simultaneous A-to-B and B-to-A transfers do not lose or duplicate money.
- Insufficient funds under concurrency returns a predictable semantic error.
- Confirmed transfer creates exactly two `LedgerEntry` rows.
- Pending-review transfer creates exactly two `LedgerEntry` rows and does not credit recipient.
- Failed transfer creates no `Transaction`, no `LedgerEntry`, and no `AuditLog`.

## 13. Acceptance Criteria for Phase 5

Phase 5 implementation is done when:

- `npm run build:api` passes.
- `docker compose up --build` works.
- `POST /transfers` requires auth.
- Successful confirmed or pending-review transfer creation returns `201 Created`.
- Confirmed transfer updates balances correctly.
- Pending-review transfer updates sender available and pending balances correctly.
- Recipient is not credited on pending-review creation.
- Invalid `amountCents` values return `VALIDATION_ERROR`, including JSON number `5000`, `"0"`, `"-1"`, `"10.50"`, `"1,000"`, and values greater than PostgreSQL `BIGINT` max.
- Insufficient funds returns `INSUFFICIENT_FUNDS`.
- Self-transfer returns `SELF_TRANSFER_NOT_ALLOWED`.
- Sender without a wallet returns `SENDER_WALLET_NOT_FOUND`.
- Unknown recipient returns `RECIPIENT_NOT_FOUND`.
- Unsupported wallet currency returns `UNSUPPORTED_CURRENCY`.
- Balance overflow returns `BALANCE_LIMIT_EXCEEDED`.
- Transfer creation is atomic: successful transfers commit all expected balance, transaction, ledger, and audit changes together; failed transfers roll back completely and leave no partial financial side effects.
- Failed transfers leave balances unchanged.
- Failed transfers create no `Transaction`, no `LedgerEntry`, and no `AuditLog` rows.
- `LedgerEntry` rows are created correctly.
- `AuditLog` row is created correctly.
- No admin review, transaction history, frontend, or tests are implemented in Phase 5.

## 14. Manual Phase 5 Validation Plan

Before Phase 7 automated tests exist, manually validate:

- Balances before and after a confirmed transfer.
- Balances before and after a pending-review transfer.
- Transaction row fields: status, amount, currency, sender, recipient, `confirmedAt`, and `riskReason`.
- Exact `LedgerEntry` row count and fields for each successful transfer.
- `AuditLog` required fields and metadata for each successful transfer.
- No side-effect rows on failures: no `Transaction`, no `LedgerEntry`, and no `AuditLog`.
- `amountCents` parsing cases: accept `"5000"`; reject JSON number `5000`, `"0"`, `"-1"`, `"10.50"`, `"1,000"`, and over-`BIGINT` values.
- Threshold boundary: `"100000"` returns `CONFIRMED`; `"100001"` returns `PENDING_REVIEW`.

## 15. Open Questions / Known Tradeoffs

- The API uses `toUserId` for Phase 5 simplicity; the frontend may later make recipient selection easier.
- Admin approval/rejection ledger behavior will be specified in Phase 6.
- Tests are planned for Phase 7, but this spec defines the behaviors they should verify.
