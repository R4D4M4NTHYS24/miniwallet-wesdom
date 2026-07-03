# MiniWallet Implementation Plan

This plan keeps implementation incremental, reviewable, and focused on financial correctness. Application code should be added only in the phase where it belongs.

## Phase 2: Docker Compose + API/Web skeleton

### Scope
- Create `apps/api`, `apps/web`, and required package configuration.
- Add Docker Compose services for API, web, and PostgreSQL.
- Add basic health checks and startup commands.
- Add TypeScript configuration and local development scripts.

### Acceptance criteria
- `docker compose up --build` starts the expected containers.
- API exposes a non-business health endpoint.
- Web app renders a minimal placeholder page.
- No transfer, auth, wallet, or financial business logic exists yet.

### Must not implement too early
- No auth flows.
- No Prisma schema.
- No wallet or transfer logic.
- No admin review endpoints.

### Validation checkpoints
- Run local install/build checks if available.
- Start services with `docker compose up --build`.
- Confirm API and web are reachable.

## Phase 3: Database schema, Prisma, migrations, seed data

### Scope
- Add Prisma setup and PostgreSQL connection configuration.
- Model `User`, `Wallet`, `Transaction`, `LedgerEntry`, and `AuditLog`.
- Use explicit money fields: `amountCents`, `availableBalanceCents`, `pendingBalanceCents`.
- Add enums for roles, transaction states, ledger directions/types, and risk reasons.
- Add seed data for local development and integration tests.

### Acceptance criteria
- Migrations apply cleanly to an empty database.
- Seed creates predictable users, wallets, and balances.
- Schema reflects the financial model from `DECISIONS.md` and `docs/analysis.md`.

### Must not implement too early
- No transfer execution logic.
- No admin approval/rejection behavior.
- No complex fraud rules beyond planned enum values.

### Validation checkpoints
- Run Prisma generate/migrate commands.
- Reset and reseed the local database.
- Inspect seeded wallet balances in cents.

## Phase 4: Auth, validation, middleware, semantic errors

### Scope
- Implement registration and login with JWT.
- Add password hashing.
- Add auth and role middleware.
- Add Zod request validation.
- Add semantic error responses with stable error codes.

### Acceptance criteria
- Users can register and log in.
- Protected routes reject missing/invalid JWTs.
- Admin-only routes reject non-admin users.
- Validation errors are predictable and consistent.

### Must not implement too early
- No financial mutations.
- No transfer balance updates.
- No admin review state transitions.

### Validation checkpoints
- Test auth success and failure paths.
- Verify representative error responses: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`.

## Phase 5: Transfer engine with atomicity, locks, LedgerEntry, available/pending balances

### Scope
- Implement `POST /transfers`.
- For `amountCents <= 100000`, create `CONFIRMED` transfers.
- For `amountCents > 100000`, create `PENDING_REVIEW` transfers with `riskReason = AMOUNT_ABOVE_REVIEW_THRESHOLD`.
- Use PostgreSQL transactions for all balance mutations.
- Use `SELECT ... FOR UPDATE` row locks where needed.
- Maintain `LedgerEntry` records for every financial movement.
- Maintain `AuditLog` records for transfer creation.

### Acceptance criteria
- Confirmed transfers debit sender available balance and credit receiver available balance atomically.
- Pending-review transfers move sender funds from available to pending balance atomically.
- Insufficient funds cannot create transactions or ledger entries.
- No successful transfer mutates balances without matching ledger and audit records.

### Must not implement too early
- No frontend transfer UI dependency.
- No advanced fraud scoring.
- No background processing or queues.

### Validation checkpoints
- Manually exercise successful confirmed transfer.
- Manually exercise pending-review transfer.
- Verify balances, transaction state, ledger entries, and audit logs in the database.

## Phase 6: Transaction history and admin suspicious review

### Scope
- Implement `GET /transactions` with pagination.
- Implement `GET /transactions/:id`.
- Implement `GET /admin/suspicious-transactions`.
- Implement `POST /admin/suspicious-transactions/:id/approve`.
- Implement `POST /admin/suspicious-transactions/:id/reject`.
- Lock transaction rows and wallet rows during admin review flows.

### Acceptance criteria
- Users can view only their own transaction history.
- Admin can list suspicious or pending-review transactions.
- Admin approval moves sender pending funds to receiver available funds exactly once.
- Admin rejection releases sender pending funds back to available funds exactly once.
- Invalid state transitions return semantic errors.

### Must not implement too early
- No complex admin dashboard.
- No partial approval.
- No multi-step review workflow.

### Validation checkpoints
- Verify pagination behavior.
- Approve and reject pending transactions locally.
- Attempt repeated approve/reject calls and confirm they fail safely.

## Phase 7: Integration tests, including concurrent transfer test

### Scope
- Add integration test setup with Vitest and Supertest.
- Cover auth, confirmed transfer, pending-review transfer, admin approve/reject, transaction history, and authorization failures.
- Add a concurrent transfer test for overspending prevention.

### Acceptance criteria
- Confirmed transfer test verifies transaction state, balances, ledger entries, and history visibility.
- Pending-review test verifies `PENDING_REVIEW`, `riskReason`, and pending balance reservation.
- Admin review tests verify approval and rejection state transitions.
- Concurrent transfer test proves only valid transfers succeed and balances never go negative.

### Must not implement too early
- No broad end-to-end browser automation.
- No performance testing suite.
- No mocking of financial database behavior in core integration tests.

### Validation checkpoints
- Run the full integration test suite from a clean database.
- Run the concurrent transfer test multiple times if practical.
- Confirm tests use PostgreSQL, not an in-memory substitute.

## Phase 8: Minimal React frontend

### Scope
- Add basic login/register UI.
- Add simple transfer form using `amountCents`.
- Add transaction history view.
- Add minimal admin suspicious transaction list with approve/reject actions.

### Acceptance criteria
- User can authenticate and perform a transfer through the UI.
- User can view transaction history.
- Admin can view and review suspicious transactions.
- UI remains simple and aligned with API behavior.

### Must not implement too early
- No complex state management.
- No design system.
- No advanced charts, filters, or analytics.

### Validation checkpoints
- Run frontend locally against the API.
- Verify main user and admin flows manually.
- Confirm mobile and desktop layouts are usable enough for review.

## Phase 9: README, AI_USAGE, documentation polish

### Scope
- Complete README with setup, Docker Compose usage, test commands, API summary, and known limitations.
- Add transparent AI usage note.
- Polish `DECISIONS.md`, `docs/analysis.md`, and diagrams for consistency.
- Ensure documentation matches implemented behavior.

### Acceptance criteria
- A reviewer can run the project from README instructions.
- AI usage is disclosed clearly and briefly.
- Architecture and ADR documentation reflect the final implementation.
- Known limitations are explicit and defensible.

### Must not implement too early
- No new features during documentation polish unless fixing a documented mismatch.
- No private prompts, local runtime files, or internal harness artifacts in public docs. AI usage may be described at a high level.

### Validation checkpoints
- Follow README from a clean checkout mindset.
- Check docs for stale endpoint names, field names, or state names.
- Confirm no harness/private files are referenced.

## Phase 10: Final release gate

### Scope
- Perform final verification before considering the technical test complete.
- Review code, tests, docs, Docker setup, and repository cleanliness.

### Acceptance criteria
- Docker Compose path works.
- API tests pass.
- Frontend builds or runs as documented.
- Financial flows are covered by integration tests.
- Documentation is consistent with behavior.

### Must not implement too early
- No last-minute scope expansion.
- No advanced fraud, ledger redesign, or frontend polish unless required to fix a correctness issue.

### Validation checkpoints
- Run final test commands.
- Run final build commands.
- Inspect git status for unintended files.
- Review sensitive files and ensure no secrets or harness/private files are included.

## Final release gate checklist

- [ ] `docker compose up --build` works from documented instructions.
- [ ] Database migrations apply from a clean database.
- [ ] Seed data works and is documented.
- [ ] API tests pass.
- [ ] Concurrent transfer integration test passes.
- [ ] Confirmed transfer preserves total money.
- [ ] Pending-review transfer reserves sender funds.
- [ ] Admin approval and rejection are atomic and state-safe.
- [ ] Ledger entries exist for all successful financial movements.
- [ ] Audit logs exist for transfer and admin review actions.
- [ ] Semantic errors are predictable and documented.
- [ ] Frontend supports minimal user and admin flows.
- [ ] README, `DECISIONS.md`, `docs/analysis.md`, and diagrams are consistent.
- [ ] AI usage note is present.
- [ ] No harness/private files are included in release scope.
- [ ] No secrets or local-only credentials are committed.
