import { beforeEach, describe, expect, it } from "bun:test";
import { RateLimitGuard } from "@interfaces/http/guards/rate-limit.guard";
import { type ExecutionContext, HttpException, HttpStatus } from "@nestjs/common";
import type { Request, Response } from "express";

function createMockContext(params: {
  path: string;
  ip?: string;
  providerId?: string;
}): {
  context: ExecutionContext;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const req = {
    path: params.path,
    url: params.path,
    ip: params.ip ?? "127.0.0.1",
    socket: { remoteAddress: params.ip ?? "127.0.0.1" },
    headers: {
      "x-provider-id": params.providerId,
    },
    providerPrincipal:
      params.providerId !== undefined ? { providerId: params.providerId } : undefined,
  } as unknown as Request;

  const res = {
    setHeader: (name: string, value: string) => {
      headers[name] = value;
    },
  } as unknown as Response;

  const context = {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;

  return { context, headers };
}

describe("RateLimitGuard (OWASP API4 & API6 Resource Consumption Defense)", () => {
  let guard: RateLimitGuard;

  beforeEach(() => {
    guard = new RateLimitGuard();
  });

  it("permits requests within quota and populates rate limit headers", () => {
    const { context, headers } = createMockContext({
      path: "/wagering/transactions",
      providerId: "provider-alpha",
    });

    const allowed = guard.canActivate(context);

    expect(allowed).toBe(true);
    expect(headers["X-RateLimit-Limit"]).toBe("60");
    expect(headers["X-RateLimit-Remaining"]).toBe("59");
    expect(headers["X-RateLimit-Reset"]).toBeDefined();
  });

  it("blocks requests exceeding quota with 429 Too Many Requests and sets Retry-After", () => {
    const { context, headers } = createMockContext({
      path: "/wagering/transactions",
      providerId: "provider-flooder",
    });

    for (let i = 0; i < 60; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }

    let error: HttpException | undefined;
    try {
      guard.canActivate(context);
    } catch (err) {
      error = err as HttpException;
    }

    expect(error).toBeInstanceOf(HttpException);
    expect(error?.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(headers["Retry-After"]).toBeDefined();
    expect(headers["X-RateLimit-Remaining"]).toBe("0");
  });

  it("differentiates quotas between distinct providers", () => {
    const ctxA = createMockContext({
      path: "/wagering/transactions",
      providerId: "provider-a",
    });
    const ctxB = createMockContext({
      path: "/wagering/transactions",
      providerId: "provider-b",
    });

    for (let i = 0; i < 60; i++) {
      guard.canActivate(ctxA.context);
    }

    expect(() => guard.canActivate(ctxA.context)).toThrow();
    expect(guard.canActivate(ctxB.context)).toBe(true);
  });

  it("exempts healthcheck and metrics routes from throttling", () => {
    const { context } = createMockContext({
      path: "/health/live",
    });

    for (let i = 0; i < 200; i++) {
      expect(guard.canActivate(context)).toBe(true);
    }
  });

  it("resets quotas cleanly upon reset call", () => {
    const { context } = createMockContext({
      path: "/wallets",
      providerId: "provider-reset-test",
    });

    for (let i = 0; i < 60; i++) {
      guard.canActivate(context);
    }

    expect(() => guard.canActivate(context)).toThrow();
    guard.reset();
    expect(guard.canActivate(context)).toBe(true);
  });
});
