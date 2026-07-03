-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('CONFIRMED', 'PENDING_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "RiskReason" AS ENUM ('AMOUNT_ABOVE_REVIEW_THRESHOLD');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerBalanceType" AS ENUM ('AVAILABLE', 'PENDING');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('TRANSFER_OUT', 'TRANSFER_IN', 'HOLD', 'RELEASE', 'REVERSAL');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wallets" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "availableBalanceCents" BIGINT NOT NULL DEFAULT 0,
    "pendingBalanceCents" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "TransactionStatus" NOT NULL,
    "riskReason" "RiskReason",
    "fromUserId" UUID NOT NULL,
    "toUserId" UUID NOT NULL,
    "fromWalletId" UUID NOT NULL,
    "toWalletId" UUID NOT NULL,
    "reviewedByUserId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "walletId" UUID NOT NULL,
    "direction" "LedgerDirection" NOT NULL,
    "balanceType" "LedgerBalanceType" NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "amountCents" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "transactionId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_userId_key" ON "wallets"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_id_userId_key" ON "wallets"("id", "userId");

-- CreateIndex
CREATE INDEX "wallets_userId_idx" ON "wallets"("userId");

-- CreateIndex
CREATE INDEX "transactions_fromUserId_createdAt_idx" ON "transactions"("fromUserId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_toUserId_createdAt_idx" ON "transactions"("toUserId", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_status_createdAt_idx" ON "transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "transactions_riskReason_createdAt_idx" ON "transactions"("riskReason", "createdAt");

-- CreateIndex
CREATE INDEX "ledger_entries_transactionId_idx" ON "ledger_entries"("transactionId");

-- CreateIndex
CREATE INDEX "ledger_entries_walletId_createdAt_idx" ON "ledger_entries"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_transactionId_idx" ON "audit_logs"("transactionId");

-- AddCheckConstraint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_availableBalanceCents_non_negative_check" CHECK ("availableBalanceCents" >= 0);

-- AddCheckConstraint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_pendingBalanceCents_non_negative_check" CHECK ("pendingBalanceCents" >= 0);

-- AddCheckConstraint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_usd_check" CHECK ("currency" = 'USD');

-- AddCheckConstraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_amountCents_positive_check" CHECK ("amountCents" > 0);

-- AddCheckConstraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_currency_usd_check" CHECK ("currency" = 'USD');

-- AddCheckConstraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_different_users_check" CHECK ("fromUserId" <> "toUserId");

-- AddCheckConstraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_different_wallets_check" CHECK ("fromWalletId" <> "toWalletId");

-- AddCheckConstraint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_pending_review_risk_reason_check" CHECK ("status" <> 'PENDING_REVIEW' OR "riskReason" = 'AMOUNT_ABOVE_REVIEW_THRESHOLD');

-- AddCheckConstraint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_amountCents_positive_check" CHECK ("amountCents" > 0);

-- AddCheckConstraint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_non_empty_check" CHECK (char_length("action") > 0);

-- AddCheckConstraint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_entityType_non_empty_check" CHECK (char_length("entityType") > 0);

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_fromWalletId_fromUserId_fkey" FOREIGN KEY ("fromWalletId", "fromUserId") REFERENCES "wallets"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_toWalletId_toUserId_fkey" FOREIGN KEY ("toWalletId", "toUserId") REFERENCES "wallets"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
