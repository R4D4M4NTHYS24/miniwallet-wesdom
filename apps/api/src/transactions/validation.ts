import { z } from "zod";
import { AppError } from "../errors.js";

export type Pagination = {
  page: number;
  pageSize: number;
  skip: number;
};

const uuidSchema = z.string().uuid();
const positiveIntegerPattern = /^[1-9][0-9]*$/;
const maxSafeIntegerString = Number.MAX_SAFE_INTEGER.toString();

function readSingleQueryValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function parsePositiveInteger(value: unknown, fieldName: "page" | "pageSize", fallback: number) {
  const rawValue = readSingleQueryValue(value);

  if (rawValue === undefined) {
    if (value !== undefined) {
      throw new AppError("VALIDATION_ERROR", "Invalid pagination parameters", 400, {
        [fieldName]: "Must be a single positive integer"
      });
    }

    return fallback;
  }

  if (!positiveIntegerPattern.test(rawValue)) {
    throw new AppError("VALIDATION_ERROR", "Invalid pagination parameters", 400, {
      [fieldName]: "Must be a positive integer"
    });
  }

  if (
    rawValue.length > maxSafeIntegerString.length ||
    (rawValue.length === maxSafeIntegerString.length && rawValue > maxSafeIntegerString)
  ) {
    throw new AppError("VALIDATION_ERROR", "Invalid pagination parameters", 400, {
      [fieldName]: "Must be less than or equal to Number.MAX_SAFE_INTEGER"
    });
  }

  return Number(rawValue);
}

export function parsePagination(query: Record<string, unknown>): Pagination {
  const page = parsePositiveInteger(query.page, "page", 1);
  const pageSize = parsePositiveInteger(query.pageSize, "pageSize", 20);

  if (pageSize > 100) {
    throw new AppError("VALIDATION_ERROR", "Invalid pagination parameters", 400, {
      pageSize: "Must be less than or equal to 100"
    });
  }

  const skip = (BigInt(page) - 1n) * BigInt(pageSize);

  if (skip > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError("VALIDATION_ERROR", "Invalid pagination parameters", 400, {
      page: "Pagination offset is too large"
    });
  }

  return { page, pageSize, skip: Number(skip) };
}

export function parseTransactionId(id: unknown) {
  const result = uuidSchema.safeParse(id);

  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid transaction id", 400, result.error.flatten());
  }

  return result.data;
}
