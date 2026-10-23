import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";

const DEFAULT_CSP = "default-src 'none'; frame-ancestors 'none'";
const DOCS_CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; connect-src 'self' *; img-src 'self' data: https:;";

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
  "X-XSS-Protection": "0",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()",
};

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    for (const [header, value] of Object.entries(BASE_SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }

    const targetUrl = `${req.originalUrl ?? ""} ${req.url ?? ""} ${req.path ?? ""}`.toLowerCase();
    const isDocs =
      targetUrl.includes("docs") || targetUrl.includes("swagger") || targetUrl.includes("openapi");
    res.setHeader("Content-Security-Policy", isDocs ? DOCS_CSP : DEFAULT_CSP);

    next();
  }
}
