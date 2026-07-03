import { Prisma } from "@prisma/client";
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "EMAIL_ALREADY_EXISTS"
  | "INVALID_CREDENTIALS"
  | "RECIPIENT_NOT_FOUND"
  | "SENDER_WALLET_NOT_FOUND"
  | "SELF_TRANSFER_NOT_ALLOWED"
  | "INSUFFICIENT_FUNDS"
  | "UNSUPPORTED_CURRENCY"
  | "BALANCE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

export function isDuplicateEmailError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    Array.isArray(error.meta?.target) &&
    error.meta.target.includes("email")
  );
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      code: error.code,
      message: error.message,
      details: error.details
    });
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      code: "VALIDATION_ERROR",
      message: "Request validation failed",
      details: error.flatten()
    });
    return;
  }

  console.error(error);

  res.status(500).json({
    code: "INTERNAL_ERROR",
    message: "Unexpected server error",
    details: {}
  });
};
