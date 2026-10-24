import type { SecurityAuditAccessEventDto } from "@application/dto/audit-trail.dto";
import type { AuditTrailPort } from "@application/ports/audit-trail.port";
import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import type { AuthenticatedHttpRequest } from "@interfaces/http/guards/provider-auth.guard";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Response } from "express";

function resolveClientIp(req: AuthenticatedHttpRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded !== undefined) {
    const rawForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (rawForwarded !== undefined && rawForwarded.trim().length > 0) {
      const firstIp = rawForwarded.split(",")[0]?.trim();
      if (firstIp !== undefined && firstIp.length > 0) {
        return firstIp;
      }
    }
  }

  const remote = req.ip ?? req.socket?.remoteAddress ?? "127.0.0.1";
  return remote.replace(/^::ffff:/, "");
}

function resolveProviderId(req: AuthenticatedHttpRequest): string | null {
  if (req.providerPrincipal?.providerId) {
    return req.providerPrincipal.providerId;
  }
  const header = req.headers["x-provider-id"];
  if (header !== undefined) {
    const resolved = Array.isArray(header) ? header[0] : header;
    return resolved !== undefined && resolved.trim().length > 0 ? resolved.trim() : null;
  }
  return null;
}

function resolveWalletId(req: AuthenticatedHttpRequest): string | undefined {
  const paramId = req.params?.id;
  if (typeof paramId === "string" && paramId.trim().length > 0) {
    return paramId.trim();
  }
  const body = req.body as { walletId?: unknown } | undefined;
  if (body !== undefined && typeof body.walletId === "string" && body.walletId.trim().length > 0) {
    return body.walletId.trim();
  }
  return undefined;
}

@Injectable()
export class AuditLoggingMiddleware implements NestMiddleware {
  constructor(
    @Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(TOKENS.AUDIT_TRAIL_PORT) private readonly auditTrailPort: AuditTrailPort,
    @Inject(TOKENS.LOGGER) private readonly logger: StructuredLoggerPort,
  ) {}

  use(req: AuthenticatedHttpRequest, res: Response, next: NextFunction): void {
    const startTime = Date.now();

    res.on("finish", () => {
      const durationMs = Math.max(1, Date.now() - startTime);
      const ambient = CorrelationContext.current();

      const correlationId =
        ambient.correlationId ??
        (res.getHeader("x-correlation-id") as string | undefined) ??
        this.idGenerator.generate();

      const traceId =
        ambient.traceId ??
        (res.getHeader("traceparent") as string | undefined)?.split("-")[1] ??
        null;

      const spanId =
        ambient.spanId ??
        (res.getHeader("traceparent") as string | undefined)?.split("-")[2] ??
        null;

      const clientIp = resolveClientIp(req);
      const providerId = resolveProviderId(req);
      const walletId = resolveWalletId(req);
      const userAgent = (req.headers["user-agent"] as string | undefined) ?? "unknown";

      const event: SecurityAuditAccessEventDto = {
        id: this.idGenerator.generate(),
        timestamp: new Date().toISOString(),
        clientIp,
        providerId,
        method: req.method,
        path: req.path ?? req.url ?? "",
        statusCode: res.statusCode,
        durationMs,
        correlationId,
        traceId,
        spanId,
        userAgent,
        walletId,
      };

      void this.auditTrailPort.record(event).catch((err) => {
        this.logger.warn(
          {
            event: "security.audit.record_failed",
            error: String(err),
          },
          "Failed to record in-memory audit event",
        );
      });

      this.logger.info(
        {
          event: "security.audit.access",
          auditId: event.id,
          clientIp,
          providerId: providerId ?? undefined,
          method: event.method,
          path: event.path,
          statusCode: event.statusCode,
          durationMs,
          correlationId,
          traceId: traceId ?? undefined,
          spanId: spanId ?? undefined,
          walletId,
        },
        "HTTP request audited for security",
      );
    });

    next();
  }
}
