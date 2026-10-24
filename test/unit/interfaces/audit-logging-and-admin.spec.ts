import { describe, expect, it } from "bun:test";
import type { SecurityAuditAccessEventDto } from "@application/ports/audit-trail.port";
import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import type {
  LogEventPayload,
  StructuredLoggerPort,
} from "@application/ports/structured-logger.port";
import { InMemoryRingBufferAuditTrailAdapter } from "@infrastructure/security/in-memory-ring-buffer-audit-trail.adapter";
import { AdminAuditController } from "@interfaces/http/admin-audit.controller";
import type { AuthenticatedHttpRequest } from "@interfaces/http/guards/provider-auth.guard";
import { CorrelationIdInterceptor } from "@interfaces/http/interceptors/correlation-id.interceptor";
import { AuditLoggingMiddleware } from "@interfaces/http/middlewares/audit-logging.middleware";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import { firstValueFrom, of } from "rxjs";

describe("Audit Logging, W3C Tracing & Admin Fiscalization (RFC-0012 / ADR-0026 & ADR-0027)", () => {
  const mockIdGenerator: IdGeneratorPort = {
    generate: () => "019488a0-9999-7000-8000-000000000099",
  };

  const loggedEvents: LogEventPayload[] = [];
  const mockLogger: StructuredLoggerPort = {
    info: (payload) => {
      loggedEvents.push(payload);
    },
    warn: (payload) => {
      loggedEvents.push(payload);
    },
    error: (payload) => {
      loggedEvents.push(payload);
    },
    debug: (payload) => {
      loggedEvents.push(payload);
    },
  };

  it("InMemoryRingBufferAuditTrailAdapter records and queries events with filters and capacity cap", async () => {
    const adapter = new InMemoryRingBufferAuditTrailAdapter(3);

    const event1: SecurityAuditAccessEventDto = {
      id: "evt-1",
      timestamp: "2026-10-23T18:00:00.000Z",
      clientIp: "10.0.0.1",
      providerId: "provider-evolution",
      method: "POST",
      path: "/api/v1/wagering/transactions",
      statusCode: 201,
      durationMs: 15,
      correlationId: "corr-1",
      traceId: "trace-1",
      spanId: "span-1",
      userAgent: "curl/8.0",
      walletId: "w-100",
    };

    const event2: SecurityAuditAccessEventDto = {
      id: "evt-2",
      timestamp: "2026-10-23T18:01:00.000Z",
      clientIp: "10.0.0.2",
      providerId: "provider-pragmatic",
      method: "POST",
      path: "/api/v1/wagering/transactions",
      statusCode: 422,
      durationMs: 8,
      correlationId: "corr-2",
      traceId: "trace-2",
      spanId: "span-2",
      userAgent: "PostmanRuntime/7.0",
      walletId: "w-100",
    };

    const event3: SecurityAuditAccessEventDto = {
      id: "evt-3",
      timestamp: "2026-10-23T18:02:00.000Z",
      clientIp: "10.0.0.1",
      providerId: "provider-evolution",
      method: "GET",
      path: "/api/v1/wallets/w-100",
      statusCode: 200,
      durationMs: 4,
      correlationId: "corr-3",
      traceId: "trace-3",
      spanId: "span-3",
      userAgent: "curl/8.0",
      walletId: "w-100",
    };

    const event4: SecurityAuditAccessEventDto = {
      id: "evt-4",
      timestamp: "2026-10-23T18:03:00.000Z",
      clientIp: "10.0.0.3",
      providerId: "provider-playtech",
      method: "POST",
      path: "/api/v1/wallets",
      statusCode: 201,
      durationMs: 25,
      correlationId: "corr-4",
      traceId: "trace-4",
      spanId: "span-4",
      userAgent: "curl/8.0",
      walletId: "w-200",
    };

    await adapter.record(event1);
    await adapter.record(event2);
    await adapter.record(event3);
    expect(adapter.totalRecorded).toBe(3);

    await adapter.record(event4);
    expect(adapter.totalRecorded).toBe(3);

    const all = await adapter.query({});
    expect(all.length).toBe(3);
    expect(all[0]?.id).toBe("evt-4");
    expect(all[2]?.id).toBe("evt-2");

    const filteredByProvider = await adapter.query({ providerId: "evolution" });
    expect(filteredByProvider.length).toBe(1);
    expect(filteredByProvider[0]?.id).toBe("evt-3");

    const filteredByStatus = await adapter.query({ statusCode: 422 });
    expect(filteredByStatus.length).toBe(1);
    expect(filteredByStatus[0]?.id).toBe("evt-2");

    const filteredByWallet = await adapter.query({ walletId: "w-200" });
    expect(filteredByWallet.length).toBe(1);
    expect(filteredByWallet[0]?.id).toBe("evt-4");
  });

  it("AuditLoggingMiddleware intercepts request, resolves client IP from x-forwarded-for, and records audit event", async () => {
    const adapter = new InMemoryRingBufferAuditTrailAdapter(10);
    const middleware = new AuditLoggingMiddleware(mockIdGenerator, adapter, mockLogger);

    const finishHandlers: (() => void)[] = [];
    const headersMap = new Map<string, string>();

    const mockReq = {
      method: "POST",
      path: "/api/v1/wagering/transactions",
      headers: {
        "x-forwarded-for": "203.0.113.195, 70.41.3.18",
        "x-provider-id": "provider-evolution",
        "user-agent": "test-agent/1.0",
      },
      params: {},
      body: {
        walletId: "019488a0-1111-7000-8000-000000000001",
      },
      socket: {
        remoteAddress: "127.0.0.1",
      },
    } as unknown as AuthenticatedHttpRequest;

    const mockRes = {
      statusCode: 201,
      getHeader: (name: string) => headersMap.get(name.toLowerCase()),
      on: (event: string, handler: () => void) => {
        if (event === "finish") {
          finishHandlers.push(handler);
        }
      },
    } as unknown as Response;

    headersMap.set("x-correlation-id", "corr-test-123");
    headersMap.set("traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01");

    let nextCalled = false;
    middleware.use(mockReq, mockRes, () => {
      nextCalled = true;
    });

    expect(nextCalled).toBe(true);

    for (const handler of finishHandlers) {
      handler();
    }

    const recorded = await adapter.query({});
    expect(recorded.length).toBe(1);
    const evt = recorded[0] as SecurityAuditAccessEventDto;
    expect(evt.clientIp).toBe("203.0.113.195");
    expect(evt.providerId).toBe("provider-evolution");
    expect(evt.statusCode).toBe(201);
    expect(evt.walletId).toBe("019488a0-1111-7000-8000-000000000001");
    expect(evt.correlationId).toBe("corr-test-123");
    expect(evt.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
    expect(evt.spanId).toBe("00f067aa0ba902b7");
  });

  it("AdminAuditController queries audit trail with parameters and wallet filtering", async () => {
    const adapter = new InMemoryRingBufferAuditTrailAdapter(10);
    const controller = new AdminAuditController(adapter);

    await adapter.record({
      id: "evt-audit-1",
      timestamp: "2026-10-23T18:10:00.000Z",
      clientIp: "192.168.1.50",
      providerId: "provider-evolution",
      method: "POST",
      path: "/api/v1/wagering/transactions",
      statusCode: 201,
      durationMs: 10,
      correlationId: "corr-1",
      traceId: "tr-1",
      spanId: "sp-1",
      userAgent: "curl",
      walletId: "w-target-1",
    });

    const res = await controller.getAuditLogs("evolution", undefined, undefined, "201");
    expect(res.total).toBe(1);
    expect(res.events[0]?.id).toBe("evt-audit-1");

    const walletRes = await controller.getWalletAuditLogs("w-target-1");
    expect(walletRes.total).toBe(1);
    expect(walletRes.walletId).toBe("w-target-1");

    const emptyRes = await controller.getWalletAuditLogs("w-unknown");
    expect(emptyRes.total).toBe(0);
  });

  it("CorrelationIdInterceptor propagates and parses W3C traceparent headers", async () => {
    const interceptor = new CorrelationIdInterceptor(mockIdGenerator);
    const responseHeaders = new Map<string, string>();

    const mockReq = {
      headers: {
        traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
        "x-correlation-id": "client-corr-id",
      },
    } as unknown as AuthenticatedHttpRequest;

    const mockRes = {
      setHeader: (name: string, value: string) => {
        responseHeaders.set(name.toLowerCase(), value);
      },
    } as unknown as Response;

    const mockContext = {
      switchToHttp: () => ({
        getRequest: () => mockReq,
        getResponse: () => mockRes,
      }),
    } as unknown as ExecutionContext;

    const mockHandler: CallHandler = {
      handle: () => of({ ok: true }),
    };

    const observable = interceptor.intercept(mockContext, mockHandler);
    const result = await firstValueFrom(observable);

    expect(result).toEqual({ ok: true });
    expect(responseHeaders.get("x-correlation-id")).toBe("client-corr-id");
    const traceparent = responseHeaders.get("traceparent");
    expect(traceparent).toBeDefined();
    expect(traceparent).toContain("4bf92f3577b34da6a3ce929d0e0e4736");
  });
});
