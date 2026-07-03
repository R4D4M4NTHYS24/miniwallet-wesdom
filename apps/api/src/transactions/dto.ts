export type TransactionDtoSource = {
  id: string;
  status: string;
  amountCents: bigint;
  currency: string;
  fromUserId: string;
  toUserId: string;
  riskReason: string | null;
  confirmedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByUserId: string | null;
  createdAt: Date;
};

export const transactionSelect = {
  id: true,
  status: true,
  amountCents: true,
  currency: true,
  fromUserId: true,
  toUserId: true,
  riskReason: true,
  confirmedAt: true,
  reviewedAt: true,
  reviewedByUserId: true,
  createdAt: true
} as const;

export function toTransactionDto(transaction: TransactionDtoSource) {
  return {
    id: transaction.id,
    status: transaction.status,
    amountCents: transaction.amountCents.toString(),
    currency: transaction.currency,
    fromUserId: transaction.fromUserId,
    toUserId: transaction.toUserId,
    riskReason: transaction.riskReason,
    confirmedAt: transaction.confirmedAt?.toISOString() ?? null,
    reviewedAt: transaction.reviewedAt?.toISOString() ?? null,
    reviewedByUserId: transaction.reviewedByUserId,
    createdAt: transaction.createdAt.toISOString()
  };
}
