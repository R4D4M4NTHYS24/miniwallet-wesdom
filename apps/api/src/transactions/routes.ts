import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../async-handler.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { toTransactionDto, transactionSelect } from "./dto.js";
import { parsePagination, parseTransactionId } from "./validation.js";

export const transactionsRouter = Router();

transactionsRouter.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.authUser;

    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const { page, pageSize, skip } = parsePagination(req.query);
    const where = {
      OR: [{ fromUserId: user.id }, { toUserId: user.id }]
    };

    const [total, transactions] = await prisma.$transaction([
      prisma.transaction.count({ where }),
      prisma.transaction.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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

transactionsRouter.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.authUser;

    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const transactionId = parseTransactionId(req.params.id);
    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      select: transactionSelect
    });

    if (!transaction) {
      throw new AppError("TRANSACTION_NOT_FOUND", "Transaction was not found", 404);
    }

    if (user.role !== "ADMIN" && transaction.fromUserId !== user.id && transaction.toUserId !== user.id) {
      throw new AppError("FORBIDDEN", "Transaction access is forbidden", 403);
    }

    res.status(200).json({ transaction: toTransactionDto(transaction) });
  })
);
