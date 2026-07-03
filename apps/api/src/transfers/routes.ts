import { Router } from "express";
import { asyncHandler } from "../async-handler.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { validateBody } from "../validation.js";
import { requireAuth } from "../auth/middleware.js";
import {
  createTransferSchema,
  postgresBigIntMax,
  type CreateTransferInput
} from "./schemas.js";

export const transfersRouter = Router();

const reviewThresholdCents = 100_000n;
const currency = "USD";

type LockedWallet = {
  id: string;
  userId: string;
  availableBalanceCents: bigint;
  pendingBalanceCents: bigint;
  currency: string;
};

type TransactionDtoSource = {
  id: string;
  status: string;
  amountCents: bigint;
  currency: string;
  fromUserId: string;
  toUserId: string;
  confirmedAt: Date | null;
  riskReason: string | null;
};

function toTransactionDto(transaction: TransactionDtoSource) {
  return {
    id: transaction.id,
    status: transaction.status,
    amountCents: transaction.amountCents.toString(),
    currency: transaction.currency,
    fromUserId: transaction.fromUserId,
    toUserId: transaction.toUserId,
    confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
    riskReason: transaction.riskReason
  };
}

function requireLockedWallet(
  wallets: LockedWallet[],
  userId: string,
  error: AppError
) {
  const wallet = wallets.find((lockedWallet) => lockedWallet.userId === userId);

  if (!wallet) {
    throw error;
  }

  return wallet;
}

function assertUsdWallets(senderWallet: LockedWallet, recipientWallet: LockedWallet) {
  if (senderWallet.currency !== currency || recipientWallet.currency !== currency) {
    throw new AppError("UNSUPPORTED_CURRENCY", "Only USD wallets are supported", 422);
  }
}

function assertCanAddBalance(currentBalance: bigint, amountCents: bigint) {
  if (currentBalance + amountCents > postgresBigIntMax) {
    throw new AppError("BALANCE_LIMIT_EXCEEDED", "Resulting wallet balance exceeds limit", 422);
  }
}

transfersRouter.post(
  "/",
  requireAuth,
  validateBody(createTransferSchema),
  asyncHandler(async (req, res) => {
    const sender = req.authUser;

    if (!sender) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const { toUserId, amountCents: amountCentsInput } = req.body as CreateTransferInput;

    if (sender.id === toUserId) {
      throw new AppError("SELF_TRANSFER_NOT_ALLOWED", "Cannot transfer to yourself", 400);
    }

    const amountCents = BigInt(amountCentsInput);
    const isPendingReview = amountCents > reviewThresholdCents;
    const status = isPendingReview ? "PENDING_REVIEW" : "CONFIRMED";
    const riskReason = isPendingReview ? "AMOUNT_ABOVE_REVIEW_THRESHOLD" : null;
    const action = isPendingReview ? "TRANSFER_PENDING_REVIEW" : "TRANSFER_CONFIRMED";

    const transaction = await prisma.$transaction(async (tx) => {
      const lockedWallets = await tx.$queryRaw<LockedWallet[]>`
        SELECT id, "userId", "availableBalanceCents", "pendingBalanceCents", currency
        FROM wallets
        WHERE "userId" IN (${sender.id}::uuid, ${toUserId}::uuid)
        ORDER BY id ASC
        FOR UPDATE
      `;

      const senderWallet = requireLockedWallet(
        lockedWallets,
        sender.id,
        new AppError("SENDER_WALLET_NOT_FOUND", "Sender wallet was not found", 409)
      );
      const recipientWallet = requireLockedWallet(
        lockedWallets,
        toUserId,
        new AppError("RECIPIENT_NOT_FOUND", "Recipient was not found", 404)
      );

      if (senderWallet.id === recipientWallet.id) {
        throw new AppError("SELF_TRANSFER_NOT_ALLOWED", "Cannot transfer to the same wallet", 400);
      }

      assertUsdWallets(senderWallet, recipientWallet);

      if (senderWallet.availableBalanceCents < amountCents) {
        throw new AppError("INSUFFICIENT_FUNDS", "Insufficient available balance", 409);
      }

      if (isPendingReview) {
        assertCanAddBalance(senderWallet.pendingBalanceCents, amountCents);
      } else {
        assertCanAddBalance(recipientWallet.availableBalanceCents, amountCents);
      }

      const createdTransaction = await tx.transaction.create({
        data: {
          amountCents,
          currency,
          status,
          riskReason,
          fromUserId: sender.id,
          toUserId,
          fromWalletId: senderWallet.id,
          toWalletId: recipientWallet.id,
          confirmedAt: isPendingReview ? null : new Date()
        },
        select: {
          id: true,
          status: true,
          amountCents: true,
          currency: true,
          fromUserId: true,
          toUserId: true,
          confirmedAt: true,
          riskReason: true
        }
      });

      if (isPendingReview) {
        await tx.wallet.update({
          where: { id: senderWallet.id },
          data: {
            availableBalanceCents: senderWallet.availableBalanceCents - amountCents,
            pendingBalanceCents: senderWallet.pendingBalanceCents + amountCents
          }
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              transactionId: createdTransaction.id,
              walletId: senderWallet.id,
              direction: "DEBIT",
              balanceType: "AVAILABLE",
              entryType: "HOLD",
              amountCents
            },
            {
              transactionId: createdTransaction.id,
              walletId: senderWallet.id,
              direction: "CREDIT",
              balanceType: "PENDING",
              entryType: "HOLD",
              amountCents
            }
          ]
        });
      } else {
        await tx.wallet.update({
          where: { id: senderWallet.id },
          data: {
            availableBalanceCents: senderWallet.availableBalanceCents - amountCents
          }
        });
        await tx.wallet.update({
          where: { id: recipientWallet.id },
          data: {
            availableBalanceCents: recipientWallet.availableBalanceCents + amountCents
          }
        });

        await tx.ledgerEntry.createMany({
          data: [
            {
              transactionId: createdTransaction.id,
              walletId: senderWallet.id,
              direction: "DEBIT",
              balanceType: "AVAILABLE",
              entryType: "TRANSFER_OUT",
              amountCents
            },
            {
              transactionId: createdTransaction.id,
              walletId: recipientWallet.id,
              direction: "CREDIT",
              balanceType: "AVAILABLE",
              entryType: "TRANSFER_IN",
              amountCents
            }
          ]
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId: sender.id,
          action,
          entityType: "Transaction",
          entityId: createdTransaction.id,
          transactionId: createdTransaction.id,
          metadata: {
            amountCents: amountCentsInput,
            currency,
            fromUserId: sender.id,
            toUserId,
            fromWalletId: senderWallet.id,
            toWalletId: recipientWallet.id,
            status,
            riskReason
          }
        }
      });

      return createdTransaction;
    });

    res.status(201).json({ transaction: toTransactionDto(transaction) });
  })
);
