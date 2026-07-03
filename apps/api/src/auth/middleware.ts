import type { RequestHandler } from "express";
import { prisma } from "../db.js";
import { AppError } from "../errors.js";
import { asyncHandler } from "../async-handler.js";
import { verifyAuthToken } from "./jwt.js";

type UserRole = "USER" | "ADMIN";

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: UserRole;
};

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthenticatedUser;
    }
  }
}

function readBearerToken(authorizationHeader: string | undefined) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const token = readBearerToken(req.header("authorization"));

  if (!token) {
    throw new AppError("UNAUTHORIZED", "Authentication token is required", 401);
  }

  const payload = verifyAuthToken(token);

  if (!payload) {
    throw new AppError("UNAUTHORIZED", "Authentication token is invalid", 401);
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, role: true }
  });

  if (!user) {
    throw new AppError("UNAUTHORIZED", "Authentication token is invalid", 401);
  }

  req.authUser = user;
  next();
});

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.authUser?.role !== "ADMIN") {
    next(new AppError("FORBIDDEN", "Admin access is required", 403));
    return;
  }

  next();
};
