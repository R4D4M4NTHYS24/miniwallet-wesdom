import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../async-handler.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { postgresBigIntMax } from "../transfers/schemas.js";
import { toTransactionDto, transactionSelect } from "../transactions/dto.js";
import { parsePagination, parseTransactionId } from "../transactions/validation.js";

export const adminRouter = Router();

const currency = "USD" as const;
const pendingReviewStatus = "PENDING_REVIEW" as const;
const confirmedStatus = "CONFIRMED" as const;
const rejectedStatus = "REJECTED" as const;
const reviewRiskReason = "AMOUNT_ABOVE_REVIEW_THRESHOLD" as const;

type LockedTransaction = {
  id: string;
  amountCents: bigint;
  currency: string;
  status: string;
  riskReason: string | null;
  fromUserId: string;
  toUserId: string;
  fromWalletId: string;
  toWalletId: string;
};

type LockedWallet = {
  id: string;
  userId: string;
  availableBalanceCents: bigint;
  pendingBalanceCents: bigint;
  currency: string;
};

type ReviewAction = "approve" | "reject";

function requireWallet(wallets: LockedWallet[], walletId: string) {
  const wallet = wallets.find((lockedWallet) => lockedWallet.id === walletId);

  if (!wallet) {
    throw new AppError("INTERNAL_ERROR", "Transaction wallet was not found", 500);
  }

  return wallet;
}

function assertReviewable(transaction: LockedTransaction) {
  if (transaction.status !== pendingReviewStatus || transaction.riskReason !== reviewRiskReason) {
    throw new AppError("TRANSACTION_NOT_REVIEWABLE", "Transaction is not reviewable", 409);
  }
}

function assertCurrency(transaction: LockedTransaction, senderWallet: LockedWallet, recipientWallet: LockedWallet) {
  if (
    transaction.currency !== currency ||
    senderWallet.currency !== currency ||
    recipientWallet.currency !== currency
  ) {
    throw new AppError("UNSUPPORTED_CURRENCY", "Only USD transactions and wallets are supported", 409);
  }
}

function assertCanAddBalance(currentBalance: bigint, amountCents: bigint) {
  if (currentBalance + amountCents > postgresBigIntMax) {
    throw new AppError("BALANCE_LIMIT_EXCEEDED", "Resulting wallet balance exceeds limit", 409);
  }
}

async function reviewTransaction(transactionId: string, adminUserId: string, action: ReviewAction) {
  return prisma.$transaction(async (tx) => {
    const lockedTransactions = await tx.$queryRaw<LockedTransaction[]>`
      SELECT id, "amountCents", currency, status::text, "riskReason"::text AS "riskReason",
             "fromUserId", "toUserId", "fromWalletId", "toWalletId"
      FROM transactions
      WHERE id = ${transactionId}::uuid
      FOR UPDATE
    `;
    const lockedTransaction = lockedTransactions[0];

    if (!lockedTransaction) {
      throw new AppError("TRANSACTION_NOT_FOUND", "Transaction was not found", 404);
    }

    const lockedWallets = await tx.$queryRaw<LockedWallet[]>`
      SELECT id, "userId", "availableBalanceCents", "pendingBalanceCents", currency
      FROM wallets
      WHERE id IN (${lockedTransaction.fromWalletId}::uuid, ${lockedTransaction.toWalletId}::uuid)
      ORDER BY id ASC
      FOR UPDATE
    `;

    const senderWallet = requireWallet(lockedWallets, lockedTransaction.fromWalletId);
    const recipientWallet = requireWallet(lockedWallets, lockedTransaction.toWalletId);

    assertReviewable(lockedTransaction);
    assertCurrency(lockedTransaction, senderWallet, recipientWallet);

    if (senderWallet.pendingBalanceCents < lockedTransaction.amountCents) {
      throw new AppError("INSUFFICIENT_PENDING_FUNDS", "Insufficient pending balance", 409);
    }

    if (action === "approve") {
      assertCanAddBalance(recipientWallet.availableBalanceCents, lockedTransaction.amountCents);
    } else {
      assertCanAddBalance(senderWallet.availableBalanceCents, lockedTransaction.amountCents);
    }

    const now = new Date();
    const newStatus = action === "approve" ? confirmedStatus : rejectedStatus;
    const auditAction = action === "approve" ? "TRANSFER_APPROVED" : "TRANSFER_REJECTED";

    if (action === "approve") {
      await tx.wallet.update({
        where: { id: senderWallet.id },
        data: {
          pendingBalanceCents: senderWallet.pendingBalanceCents - lockedTransaction.amountCents
        }
      });
      await tx.wallet.update({
        where: { id: recipientWallet.id },
        data: {
          availableBalanceCents: recipientWallet.availableBalanceCents + lockedTransaction.amountCents
        }
      });
    } else {
      await tx.wallet.update({
        where: { id: senderWallet.id },
        data: {
          availableBalanceCents: senderWallet.availableBalanceCents + lockedTransaction.amountCents,
          pendingBalanceCents: senderWallet.pendingBalanceCents - lockedTransaction.amountCents
        }
      });
    }

    const updatedTransaction = await tx.transaction.update({
      where: { id: lockedTransaction.id },
      data: {
        status: newStatus,
        reviewedByUserId: adminUserId,
        reviewedAt: now,
        confirmedAt: action === "approve" ? now : null
      },
      select: transactionSelect
    });

    await tx.ledgerEntry.createMany({
      data:
        action === "approve"
          ? [
              {
                transactionId: lockedTransaction.id,
                walletId: senderWallet.id,
                direction: "DEBIT",
                balanceType: "PENDING",
                entryType: "RELEASE",
                amountCents: lockedTransaction.amountCents
              },
              {
                transactionId: lockedTransaction.id,
                walletId: recipientWallet.id,
                direction: "CREDIT",
                balanceType: "AVAILABLE",
                entryType: "TRANSFER_IN",
                amountCents: lockedTransaction.amountCents
              }
            ]
          : [
              {
                transactionId: lockedTransaction.id,
                walletId: senderWallet.id,
                direction: "DEBIT",
                balanceType: "PENDING",
                entryType: "REVERSAL",
                amountCents: lockedTransaction.amountCents
              },
              {
                transactionId: lockedTransaction.id,
                walletId: senderWallet.id,
                direction: "CREDIT",
                balanceType: "AVAILABLE",
                entryType: "REVERSAL",
                amountCents: lockedTransaction.amountCents
              }
            ]
    });

    await tx.auditLog.create({
      data: {
        actorUserId: adminUserId,
        action: auditAction,
        entityType: "Transaction",
        entityId: lockedTransaction.id,
        transactionId: lockedTransaction.id,
        metadata: {
          amountCents: lockedTransaction.amountCents.toString(),
          currency: lockedTransaction.currency,
          fromUserId: lockedTransaction.fromUserId,
          toUserId: lockedTransaction.toUserId,
          fromWalletId: lockedTransaction.fromWalletId,
          toWalletId: lockedTransaction.toWalletId,
          reviewedByUserId: adminUserId,
          previousStatus: lockedTransaction.status,
          newStatus,
          riskReason: lockedTransaction.riskReason
        }
      }
    });

    return updatedTransaction;
  });
}

adminRouter.get(
  "/suspicious-transactions",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req.query);
    const where = {
      status: pendingReviewStatus,
      riskReason: reviewRiskReason
    };

    const [total, transactions] = await prisma.$transaction([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip,
        take: pageSize,
        select: transactionSelect
      })
    ]);

    res.status(200).json({
      items: transactions.map(toTransactionDto),
      page,
      pageSize,
      total
    });
  })
);

adminRouter.post(
  "/transactions/:id/approve",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const adminUser = req.authUser;

    if (!adminUser) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const transactionId = parseTransactionId(req.params.id);
    const transaction = await reviewTransaction(transactionId, adminUser.id, "approve");

    res.status(200).json({ transaction: toTransactionDto(transaction) });
  })
);

adminRouter.post(
  "/transactions/:id/reject",
  requireAuth,
  requireAdmin,
  asyncHandler(async (req, res) => {
    const adminUser = req.authUser;

    if (!adminUser) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const transactionId = parseTransactionId(req.params.id);
    const transaction = await reviewTransaction(transactionId, adminUser.id, "reject");

    res.status(200).json({ transaction: toTransactionDto(transaction) });
  })
);
