export interface LogTelemetryContext {
  readonly correlationId?: string | undefined;
  readonly causationId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly transactionId?: string | undefined;
  readonly walletId?: string | undefined;
  readonly providerId?: string | undefined;
  readonly roundId?: string | undefined;
}

export interface LogEventPayload extends LogTelemetryContext {
  readonly event: string;
  readonly [key: string]: unknown;
}

export interface StructuredLoggerPort {
  info(payload: LogEventPayload, message?: string): void;
  warn(payload: LogEventPayload, message?: string): void;
  error(payload: LogEventPayload, message?: string): void;
  debug(payload: LogEventPayload, message?: string): void;
}
