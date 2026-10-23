import {
  InboxMessageOutputDto,
  InboxMessageState,
  ReceiveInboxInput,
  ReceiveInboxProps,
} from "@domain/messaging/messaging.types";

export type { InboxMessageOutputDto, InboxMessageState, ReceiveInboxInput, ReceiveInboxProps };

export class InboxMessage {
  public readonly messageId: string;
  public readonly consumerName: string;
  public readonly payloadHash: string;
  public readonly receivedAt: Date;
  private _processedAt: Date | undefined;

  private constructor(state: InboxMessageState) {
    this.messageId = state.messageId;
    this.consumerName = state.consumerName;
    this.payloadHash = state.payloadHash;
    this.receivedAt = state.receivedAt;
    this._processedAt = state.processedAt;
  }

  static receive(input: ReceiveInboxInput): InboxMessage {
    return new InboxMessage({
      messageId: input.messageId,
      consumerName: input.consumerName,
      payloadHash: input.payloadHash,
      receivedAt: input.receivedAt ?? new Date(),
      processedAt: undefined,
    });
  }

  static rehydrate(state: InboxMessageState): InboxMessage {
    return new InboxMessage(state);
  }

  get processedAt(): Date | undefined {
    return this._processedAt;
  }

  isProcessed(): boolean {
    return this._processedAt !== undefined;
  }

  matchesPayload(payloadHash: string): boolean {
    return this.payloadHash === payloadHash;
  }

  markProcessed(at: Date): void {
    this._processedAt = at;
  }

  toJSON(): InboxMessageOutputDto {
    return {
      messageId: this.messageId,
      consumerName: this.consumerName,
      payloadHash: this.payloadHash,
      receivedAt: this.receivedAt.toISOString(),
      processedAt: this._processedAt?.toISOString(),
    };
  }
}
