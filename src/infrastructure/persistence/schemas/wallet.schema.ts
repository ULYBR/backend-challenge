import { EntitySchema } from "@mikro-orm/core";

export class WalletRecord {
  id!: string;
  playerId!: string;
  currency!: string;
  balance!: string;
  version!: number;
  createdAt!: Date;
  updatedAt!: Date;
}

export const WalletEntitySchema = new EntitySchema<WalletRecord>({
  class: WalletRecord,
  tableName: "wallets",
  properties: {
    id: { type: "uuid", primary: true, fieldName: "id" },
    playerId: { type: "uuid", fieldName: "player_id" },
    currency: { type: "string", length: 3, fieldName: "currency" },
    balance: { type: "numeric", precision: 19, scale: 2, fieldName: "balance" },
    version: { type: "integer", fieldName: "version" },
    createdAt: { type: "Date", fieldName: "created_at" },
    updatedAt: { type: "Date", fieldName: "updated_at" },
  },
});
