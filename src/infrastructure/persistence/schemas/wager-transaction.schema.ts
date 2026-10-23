import { EntitySchema } from "@mikro-orm/core";

export class WagerTransactionRecord {
  id!: string;
  providerId!: string;
  externalTransactionId!: string;
  idempotencyKey!: string;
  payloadHash!: string;
  walletId!: string;
  playerId!: string;
  roundId!: string;
  gameId!: string;
  kind!: string;
  amount!: string;
  currency!: string;
  referenceExternalTransactionId!: string | null;
  referenceTransactionId!: string | null;
  status!: string;
  failureCode!: string | null;
  recordedBalance!: string | null;
  referenceAttempts!: number;
  nextReferenceAttemptAt!: Date | null;
  createdAt!: Date;
  processedAt!: Date | null;
  updatedAt!: Date;
}

export const WagerTransactionEntitySchema = new EntitySchema<WagerTransactionRecord>({
  class: WagerTransactionRecord,
  tableName: "wager_transactions",
  properties: {
    id: { type: "uuid", primary: true, fieldName: "id" },
    providerId: { type: "text", fieldName: "provider_id" },
    externalTransactionId: { type: "text", fieldName: "external_transaction_id" },
    idempotencyKey: { type: "text", fieldName: "idempotency_key" },
    payloadHash: { type: "string", length: 64, fieldName: "payload_hash" },
    walletId: { type: "uuid", fieldName: "wallet_id" },
    playerId: { type: "uuid", fieldName: "player_id" },
    roundId: { type: "text", fieldName: "round_id" },
    gameId: { type: "text", fieldName: "game_id" },
    kind: { type: "text", fieldName: "kind" },
    amount: { type: "numeric", precision: 19, scale: 2, fieldName: "amount" },
    currency: { type: "string", length: 3, fieldName: "currency" },
    referenceExternalTransactionId: {
      type: "text",
      nullable: true,
      fieldName: "reference_external_transaction_id",
    },
    referenceTransactionId: {
      type: "uuid",
      nullable: true,
      fieldName: "reference_transaction_id",
    },
    status: { type: "text", fieldName: "status" },
    failureCode: { type: "text", nullable: true, fieldName: "failure_code" },
    recordedBalance: {
      type: "numeric",
      precision: 19,
      scale: 2,
      nullable: true,
      fieldName: "recorded_balance",
    },
    referenceAttempts: { type: "integer", fieldName: "reference_attempts" },
    nextReferenceAttemptAt: {
      type: "Date",
      nullable: true,
      fieldName: "next_reference_attempt_at",
    },
    createdAt: { type: "Date", fieldName: "created_at" },
    processedAt: { type: "Date", nullable: true, fieldName: "processed_at" },
    updatedAt: { type: "Date", fieldName: "updated_at" },
  },
});
