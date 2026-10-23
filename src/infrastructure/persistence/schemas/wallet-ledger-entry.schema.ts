import { EntitySchema } from "@mikro-orm/core";

export class WalletLedgerEntryRecord {
  id!: string;
  walletId!: string;
  transactionId!: string;
  walletVersion!: number;
  direction!: string;
  amount!: string;
  currency!: string;
  balanceBefore!: string;
  balanceAfter!: string;
  createdAt!: Date;
}

export const WalletLedgerEntryEntitySchema = new EntitySchema<WalletLedgerEntryRecord>({
  class: WalletLedgerEntryRecord,
  tableName: "wallet_ledger_entries",
  properties: {
    id: { type: "uuid", primary: true, fieldName: "id" },
    walletId: { type: "uuid", fieldName: "wallet_id" },
    transactionId: { type: "uuid", fieldName: "transaction_id" },
    walletVersion: { type: "integer", fieldName: "wallet_version" },
    direction: { type: "text", fieldName: "direction" },
    amount: { type: "numeric", precision: 19, scale: 2, fieldName: "amount" },
    currency: { type: "string", length: 3, fieldName: "currency" },
    balanceBefore: {
      type: "numeric",
      precision: 19,
      scale: 2,
      fieldName: "balance_before",
    },
    balanceAfter: {
      type: "numeric",
      precision: 19,
      scale: 2,
      fieldName: "balance_after",
    },
    createdAt: { type: "Date", fieldName: "created_at" },
  },
});
