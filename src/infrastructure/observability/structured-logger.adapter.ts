import type {
  LogEventPayload,
  StructuredLoggerPort,
} from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import type { AppEnv } from "@infrastructure/config/env";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import { Inject, Injectable } from "@nestjs/common";
import { PinoLogger } from "nestjs-pino";

const FORBIDDEN_FINANCIAL_KEYS = new Set([
  "money",
  "amount",
  "balance",
  "balanceBefore",
  "balanceAfter",
  "initialBalance",
  "storedBalance",
  "calculatedBalance",
]);

function sanitizePayload(payload: LogEventPayload, instanceId: string): Record<string, unknown> {
  const ambient = CorrelationContext.current();
  const merged: Record<string, unknown> = {
    instanceId,
    ...ambient,
  };

  if (ambient.traceId !== undefined) {
    merged["dd.trace_id"] = ambient.traceId;
  }
  if (ambient.spanId !== undefined) {
    merged["dd.span_id"] = ambient.spanId;
  }

  for (const [key, value] of Object.entries(payload)) {
    if (!FORBIDDEN_FINANCIAL_KEYS.has(key) && value !== undefined) {
      merged[key] = value;
    }
  }

  return merged;
}

@Injectable()
export class PinoStructuredLoggerAdapter implements StructuredLoggerPort {
  constructor(
    private readonly pino: PinoLogger,
    @Inject(TOKENS.APP_ENV) private readonly env: AppEnv,
  ) {}

  info(payload: LogEventPayload, message?: string): void {
    this.pino.info(sanitizePayload(payload, this.env.INSTANCE_ID), message ?? payload.event);
  }

  warn(payload: LogEventPayload, message?: string): void {
    this.pino.warn(sanitizePayload(payload, this.env.INSTANCE_ID), message ?? payload.event);
  }

  error(payload: LogEventPayload, message?: string): void {
    this.pino.error(sanitizePayload(payload, this.env.INSTANCE_ID), message ?? payload.event);
  }

  debug(payload: LogEventPayload, message?: string): void {
    this.pino.debug(sanitizePayload(payload, this.env.INSTANCE_ID), message ?? payload.event);
  }
}
