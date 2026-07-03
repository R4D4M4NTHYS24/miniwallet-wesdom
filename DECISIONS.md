# MiniWallet Technical Decisions

This document records the main implementation decisions for the MiniWallet technical test. Decisions are intentionally concise and focused on financial correctness, reproducibility, and code review clarity.

## ADR 001 — API stack: Node.js, TypeScript, and Express

### Context
MiniWallet needs a small HTTP API for authentication, transfers, transaction history, and admin review endpoints.

### Decision
Use Node.js with TypeScript and Express for the API.

### Rationale
This stack is simple, widely understood, quick to validate locally, and appropriate for a technical test where correctness and readability matter more than framework complexity.

### Trade-offs
Express requires explicit structure for validation, error handling, and dependency boundaries, but this keeps the implementation transparent and easy to review.

## ADR 002 — PostgreSQL as the transactional source of truth

### Context
Wallet transfers must be atomic, concurrent-safe, and auditable. No money can be lost or duplicated.

### Decision
Use PostgreSQL as the source of truth for users, wallets, transactions, ledger entries, and audit logs.

### Rationale
PostgreSQL provides ACID transactions, row-level locking, constraints, and predictable behavior under concurrent writes.

### Trade-offs
This introduces database setup requirements, but Docker Compose will make the local environment reproducible.

## ADR 003 — Prisma with raw SQL for row-level locks

### Context
The project needs productivity for most database operations, but financial operations require explicit row locking.

### Decision
Use Prisma for schema management and regular queries. Use raw SQL only where needed for `SELECT ... FOR UPDATE` row-level locks.

### Rationale
Prisma improves development speed and type safety, while raw SQL gives precise control over concurrency-critical wallet and transaction locks.

### Trade-offs
Mixing Prisma and raw SQL requires discipline, but limiting raw SQL to locking paths keeps the approach maintainable.

## ADR 004 — Store money as integer cents with explicit names

### Context
Financial calculations must avoid floating-point precision errors and ambiguous units.

### Decision
Persist money as integer cents using explicit field names such as `amountCents`, `availableBalanceCents`, and `pendingBalanceCents`.

### Rationale
Integer cents make arithmetic deterministic and field names make units clear during implementation and review.

### Trade-offs
The API and UI may need formatting/parsing between dollars and cents, but this is safer than storing decimal or floating-point values.

## ADR 005 — Explicit transaction states

### Context
Transfers can be immediately confirmed or require review before confirmation.

### Decision
Model transaction state with `CONFIRMED`, `PENDING_REVIEW`, and `REJECTED`.

### Rationale
Explicit states make the transfer lifecycle clear and support validation rules for admin approval and rejection.

### Trade-offs
The state machine adds implementation checks, but it prevents ambiguous or repeated financial transitions.

## ADR 006 — Suspicious transfer risk reason

### Context
Transfers above 1000 USD must go through validation before being confirmed.

### Decision
Use `riskReason`, starting with `AMOUNT_ABOVE_REVIEW_THRESHOLD`, for suspicious or pending-review transfers.

### Rationale
This records why a transaction entered review and gives the admin endpoint a clear filterable signal.

### Trade-offs
The initial suspicious-transaction model is intentionally simple and does not attempt advanced fraud detection.

## ADR 007 — Immutable LedgerEntry for financial traceability

### Context
Financial operations must be auditable beyond the current wallet balance and business transaction status.

### Decision
Include a simple immutable `LedgerEntry` model to record financial movements associated with transactions.

### Rationale
Ledger entries make it possible to explain wallet balance changes over time and distinguish balance mutations from business events.

### Trade-offs
This adds a small amount of model and write-path complexity, but significantly improves defensibility for a fintech-oriented review.

## ADR 008 — Separate Transaction, LedgerEntry, and AuditLog responsibilities

### Context
The system needs to represent business state, financial movements, and operational actions without mixing concepts.

### Decision
Use `Transaction` for business transfer state, `LedgerEntry` for immutable financial movements, and `AuditLog` for actions/events.

### Rationale
Separation of concerns makes auditability clearer and avoids overloading one table with multiple meanings.

### Trade-offs
Queries may need to join multiple tables, but each table has a clear purpose and review story.

## ADR 009 — Admin approve/reject endpoints are minimal scope

### Context
High-value transfers enter `PENDING_REVIEW` and must be validated before being confirmed.

### Decision
Implement admin endpoints: `POST /admin/suspicious-transactions/:id/approve` and `POST /admin/suspicious-transactions/:id/reject`.

### Rationale
Without approve/reject endpoints, the pending review lifecycle would be incomplete.

### Trade-offs
This expands backend scope, but it is necessary to fully satisfy the high-value transfer requirement.

## ADR 010 — Lock wallet and transaction rows during financial operations

### Context
Multiple users can transfer concurrently, and admin review actions may run at the same time.

### Decision
Lock wallet rows during transfer creation and lock transaction plus wallet rows during admin approval/rejection flows.

### Rationale
Row-level locks prevent lost updates, double approvals, double rejections, and overspending under concurrent requests.

### Trade-offs
Locks may reduce throughput under contention, but correctness is more important for this technical test.

## ADR 011 — Concurrent transfer integration test as core validation

### Context
The requirements explicitly include multiple concurrent users transferring at the same time.

### Decision
Include a concurrent transfer integration test as part of the core validation suite.

### Rationale
Testing concurrent transfers demonstrates that atomicity and row-level locking work in the most important failure scenario.

### Trade-offs
Concurrency tests can be slightly more complex and timing-sensitive, but they provide high confidence in financial correctness.

## ADR 012 — Minimal frontend scope

### Context
The core challenge is financial correctness, transfer state management, auditability, and reproducible validation.

### Decision
Keep the React frontend minimal and focus effort on backend correctness, tests, Docker Compose, and documentation.

### Rationale
A simple frontend is enough to demonstrate web usage while preserving time for the highest-risk backend requirements.

### Trade-offs
The UI will be less polished, but the implementation will better address the requirements most relevant to a fintech wallet system.

## ADR 013 — Docker Compose for reproducible local execution

### Context
Reviewers need to run the API, web app, database, and tests with minimal setup.

### Decision
Use Docker Compose for local infrastructure and reproducible execution.

### Rationale
Docker Compose reduces environment drift and makes the technical test easier to evaluate.

### Trade-offs
Container configuration adds setup files, but it improves reviewer experience and repeatability.

## ADR 014 — Database constraints for financial integrity

### Context
Wallet systems should not rely only on application logic for financial invariants.

### Decision
Use database `CHECK` constraints for non-negative balances, positive amounts, USD-only currency, different users/wallets, and pending review risk reason. Use composite foreign keys so transaction wallets must belong to the corresponding transaction users.

### Rationale
Database constraints protect against invalid data even if a service bug or manual database operation occurs. They also improve auditability and make the financial model easier to defend in code review.

### Trade-offs
Some constraints are visible in migration SQL rather than the Prisma schema because Prisma has limited native `CHECK` constraint support. This slightly increases migration complexity, but improves financial correctness.

## ADR 015 — Transfer amounts use strings at the API boundary

### Context
PostgreSQL stores `amountCents` as `BIGINT`. JavaScript numbers can lose precision for large integers, Prisma returns `BigInt` values that require explicit serialization, and `AuditLog` metadata cannot store raw JavaScript `bigint` values directly.

### Decision
`POST /transfers` receives `amountCents` as a base-10 positive integer string. The API rejects JSON numbers for `amountCents`, validates the string before converting it to `BigInt`, serializes `amountCents` as strings in API responses, and serializes `amountCents` and other BigInt-like values as strings in audit metadata.

### Rationale
This avoids unsafe JavaScript number rounding, keeps API, database, and audit behavior consistent, and makes validation and error handling explicit.

### Trade-offs
Clients must send `amountCents` as a string, which is slightly less ergonomic. The API contract is more explicit and safer for financial values.
