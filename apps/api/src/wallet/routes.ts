import { Router } from "express";
import { asyncHandler } from "../async-handler.js";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";

export const walletRouter = Router();

walletRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = req.authUser;

    if (!user) {
      throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
    }

    const wallet = await prisma.wallet.findUnique({
      where: { userId: user.id },
      select: {
        availableBalanceCents: true,
        pendingBalanceCents: true,
        currency: true
      }
    });

    if (!wallet) {
      throw new AppError("WALLET_NOT_FOUND", "Wallet was not found", 404);
    }

    res.status(200).json({
      wallet: {
        availableBalanceCents: wallet.availableBalanceCents.toString(),
        pendingBalanceCents: wallet.pendingBalanceCents.toString(),
        currency: wallet.currency
      }
    });
  })
);
