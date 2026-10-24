export interface LogTelemetryContext {
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly walletId?: string | undefined;
  readonly providerId?: string | undefined;
  readonly roundId?: string | undefined;
  readonly traceId?: string | undefined;
  readonly spanId?: string | undefined;
}

export interface LogEventPayload extends LogTelemetryContext {
  readonly event: string;
  readonly [key: string]: unknown;
}
