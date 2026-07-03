import { z } from "zod";

export const postgresBigIntMax = 9_223_372_036_854_775_807n;

const positiveIntegerPattern = /^[1-9][0-9]*$/;
const postgresBigIntMaxDigits = postgresBigIntMax.toString().length;

const positiveIntegerStringSchema = z.string().superRefine((value, context) => {
  if (value.length > postgresBigIntMaxDigits) {
    context.addIssue({
      code: "custom",
      message: "amountCents exceeds PostgreSQL BIGINT range"
    });
    return;
  }

  if (!positiveIntegerPattern.test(value)) {
    context.addIssue({
      code: "custom",
      message: "amountCents must be a base-10 positive integer string"
    });
    return;
  }

  if (BigInt(value) > postgresBigIntMax) {
    context.addIssue({
      code: "custom",
      message: "amountCents exceeds PostgreSQL BIGINT range"
    });
  }
});

export const createTransferSchema = z.object({
  toUserId: z.string().uuid(),
  amountCents: positiveIntegerStringSchema
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
