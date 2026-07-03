import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { AppError } from "./errors.js";

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      next(
        new AppError("VALIDATION_ERROR", "Request validation failed", 400, result.error.flatten())
      );
      return;
    }

    req.body = result.data;
    next();
  };
}
