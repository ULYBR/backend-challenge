import type {
  LogEventPayload,
  LogTelemetryContext,
} from "@application/ports/structured-logger.types";

export type { LogEventPayload, LogTelemetryContext };

export interface StructuredLoggerPort {
  info(payload: LogEventPayload, message?: string): void;
  warn(payload: LogEventPayload, message?: string): void;
  error(payload: LogEventPayload, message?: string): void;
  debug(payload: LogEventPayload, message?: string): void;
}
