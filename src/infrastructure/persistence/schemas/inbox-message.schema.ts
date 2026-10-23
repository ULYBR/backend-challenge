import { EntitySchema } from "@mikro-orm/core";

export class InboxMessageRecord {
  consumerName!: string;
  messageId!: string;
  payloadHash!: string;
  receivedAt!: Date;
  processedAt!: Date | null;
}

export const InboxMessageEntitySchema = new EntitySchema<InboxMessageRecord>({
  class: InboxMessageRecord,
  tableName: "inbox_messages",
  properties: {
    consumerName: { type: "text", primary: true, fieldName: "consumer_name" },
    messageId: { type: "text", primary: true, fieldName: "message_id" },
    payloadHash: { type: "string", length: 64, fieldName: "payload_hash" },
    receivedAt: { type: "Date", fieldName: "received_at" },
    processedAt: { type: "Date", nullable: true, fieldName: "processed_at" },
  },
});
