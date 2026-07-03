import { Router } from "express";
import type { User } from "@prisma/client";
import { asyncHandler } from "../async-handler.js";
import { prisma } from "../db.js";
import { AppError, isDuplicateEmailError } from "../errors.js";
import { validateBody } from "../validation.js";
import { signAuthToken } from "./jwt.js";
import { requireAdmin, requireAuth, type AuthenticatedUser } from "./middleware.js";
import { hashPassword, verifyPassword } from "./password.js";
import { authCredentialsSchema, type AuthCredentials } from "./schemas.js";

export const authRouter = Router();

function toSafeUser(user: Pick<User, "id" | "email" | "role">) {
  return {
    id: user.id,
    email: user.email,
    role: user.role
  };
}

function authResponse(user: Pick<User, "id" | "email" | "role">) {
  return {
    token: signAuthToken(user.id),
    user: toSafeUser(user)
  };
}

authRouter.post(
  "/register",
  validateBody(authCredentialsSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as AuthCredentials;
    const passwordHash = await hashPassword(password);

    try {
      const user = await prisma.$transaction(async (tx) => {
        return tx.user.create({
          data: {
            email,
            passwordHash,
            role: "USER",
            wallet: {
              create: {
                currency: "USD"
              }
            }
          },
          select: { id: true, email: true, role: true }
        });
      });

      res.status(201).json(authResponse(user));
    } catch (error) {
      if (isDuplicateEmailError(error)) {
        throw new AppError("EMAIL_ALREADY_EXISTS", "Email is already registered", 409);
      }

      throw error;
    }
  })
);

authRouter.post(
  "/login",
  validateBody(authCredentialsSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as AuthCredentials;
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, passwordHash: true, role: true }
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new AppError("INVALID_CREDENTIALS", "Invalid email or password", 401);
    }

    res.status(200).json(authResponse(user));
  })
);

authRouter.get("/me", requireAuth, (req, res) => {
  res.status(200).json({ user: toSafeUser(req.authUser as AuthenticatedUser) });
});

authRouter.get("/admin-check", requireAuth, requireAdmin, (req, res) => {
  res.status(200).json({ user: toSafeUser(req.authUser as AuthenticatedUser) });
});
