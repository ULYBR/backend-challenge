import { InboxMessage } from "@domain/messaging/inbox-message";
import { InboxMessageRecord } from "@infrastructure/persistence/schemas/inbox-message.schema";

export class InboxMessageMapper {
  private constructor() {}

  static toDomain(record: InboxMessageRecord): InboxMessage {
    return InboxMessage.rehydrate({
      consumerName: record.consumerName,
      messageId: record.messageId,
      payloadHash: record.payloadHash.trim(),
      receivedAt: new Date(record.receivedAt),
      processedAt:
        record.processedAt !== null && record.processedAt !== undefined
          ? new Date(record.processedAt)
          : undefined,
    });
  }

  static toRecord(message: InboxMessage): InboxMessageRecord {
    const record = new InboxMessageRecord();
    record.consumerName = message.consumerName;
    record.messageId = message.messageId;
    record.payloadHash = message.payloadHash;
    record.receivedAt = message.receivedAt;
    record.processedAt = message.processedAt ?? null;
    return record;
  }
}
