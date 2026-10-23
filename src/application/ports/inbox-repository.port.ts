import { InboxMessage } from "@domain/messaging/inbox-message";

export interface InboxRepositoryPort {
  findByKey(consumerName: string, messageId: string): Promise<InboxMessage | null>;
  insert(message: InboxMessage): Promise<void>;
  update(message: InboxMessage): Promise<void>;
}
