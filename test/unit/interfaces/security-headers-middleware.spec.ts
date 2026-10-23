import { describe, expect, it } from "bun:test";
import { SecurityHeadersMiddleware } from "@interfaces/http/middlewares/security-headers.middleware";
import type { NextFunction, Request, Response } from "express";

describe("SecurityHeadersMiddleware (OWASP API8 & A05 Security Headers Defense)", () => {
  it("injects all mandatory OWASP security headers into HTTP response", () => {
    const middleware = new SecurityHeadersMiddleware();
    const headers: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    } as unknown as Response;
    const req = {} as Request;

    let nextCalled = false;
    const next: NextFunction = () => {
      nextCalled = true;
    };

    middleware.use(req, res, next);

    expect(nextCalled).toBe(true);
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(headers["Content-Security-Policy"]).toBe("default-src 'none'; frame-ancestors 'none'");
    expect(headers["X-XSS-Protection"]).toBe("0");
    expect(headers["Referrer-Policy"]).toBe("no-referrer");
    expect(headers["Permissions-Policy"]).toBe("geolocation=(), camera=(), microphone=()");
  });
});
