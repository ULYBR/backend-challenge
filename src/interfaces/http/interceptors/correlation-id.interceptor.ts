import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import { TOKENS } from "@application/ports/tokens";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

function parseTraceParent(header: string | undefined): { traceId: string; spanId: string } | null {
  if (header === undefined) {
    return null;
  }
  const parts = header.trim().split("-");
  if (parts.length >= 4 && parts[1]?.length === 32 && parts[2]?.length === 16) {
    return { traceId: parts[1], spanId: parts[2] };
  }
  return null;
}

function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(@Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const headerValue = request.headers["x-correlation-id"];
    const incomingCorrelationId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const correlationId =
      incomingCorrelationId !== undefined && incomingCorrelationId.trim().length > 0
        ? incomingCorrelationId.trim()
        : this.idGenerator.generate();

    const traceParentHeader = request.headers.traceparent;
    const incomingTraceParent = Array.isArray(traceParentHeader)
      ? traceParentHeader[0]
      : traceParentHeader;
    const parsedTrace = parseTraceParent(incomingTraceParent);

    const traceId = parsedTrace?.traceId ?? generateTraceId();
    const spanId = generateSpanId();

    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("traceparent", `00-${traceId}-${spanId}-01`);

    return CorrelationContext.run({ correlationId, traceId, spanId }, () => next.handle());
  }
}
