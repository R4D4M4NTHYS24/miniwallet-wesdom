# AI Usage

AI was used as an assistant throughout the MiniWallet technical test, mainly for planning, implementation support, review, test-case design, documentation polish, and final delivery checks.

## How AI was used

AI supported the work in these areas:

- Breaking down the problem into implementation phases and validation tasks.
- Reviewing the challenge requirements and identifying the highest-risk areas: financial correctness, concurrent transfers, pending-review state, auditability, and reproducible setup.
- Suggesting edge cases for integration tests, especially around insufficient funds, pending transfers, admin review, pagination, and concurrent transfers.
- Reviewing code and documentation for consistency, missing requirements, stale wording, and delivery risks.
- Helping polish documentation such as README, decisions, analysis notes, and final validation summaries.

## Human-owned decisions

The final technical and product decisions were human-owned, including:

- The architecture and stack selection.
- The money model using integer cents.
- The available balance vs pending balance model.
- The rule that transfers above 100000 cents require admin review.
- The decision to prioritize financial correctness over throughput under contention.
- The database transaction and locking approach.
- The validation scope and final acceptance criteria.
- The decision to keep the frontend as a reviewer-oriented UI rather than a full production backoffice.

## Validation of AI-assisted work

AI-assisted suggestions were not accepted blindly. The final implementation was validated through:

- TypeScript builds for API and Web.
- Docker Compose fresh-clone validation.
- PostgreSQL migrations and seed execution.
- Integration tests against a real database.
- Manual smoke testing of registration, login, transfers, pending review, approve/reject, history, and wallet balances.
- Manual review of documentation and delivery files.

## Responsibility

The final responsibility for the architecture, implementation, documentation, validation, and repository contents remains human-owned. AI was used as an assistant and reviewer, not as a replacement for technical ownership.
