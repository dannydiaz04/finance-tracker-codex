import type { Transaction } from "@/lib/types/finance";

export type TransferMatch = {
  leftId: string;
  rightId: string;
  score: number;
};

export function detectTransferPairs(transactions: Transaction[]) {
  const matches: TransferMatch[] = [];

  for (const left of transactions) {
    for (const right of transactions) {
      if (left.transactionId >= right.transactionId) {
        continue;
      }

      const sameDayWindow =
        Math.abs(
          new Date(left.postedAt).getTime() - new Date(right.postedAt).getTime(),
        ) <=
        1000 * 60 * 60 * 24 * 3;

      const oppositeDirection =
        Math.sign(left.signedAmount) !== Math.sign(right.signedAmount);

      const amountMatch =
        Math.abs(Math.abs(left.signedAmount) - Math.abs(right.signedAmount)) <
        0.01;

      const linkedTransfer =
        left.isTransfer ||
        right.isTransfer ||
        left.descriptionNorm.includes("transfer") ||
        right.descriptionNorm.includes("transfer");

      if (sameDayWindow && oppositeDirection && amountMatch && linkedTransfer) {
        matches.push({
          leftId: left.transactionId,
          rightId: right.transactionId,
          score: 0.98,
        });
      }
    }
  }

  return matches;
}
