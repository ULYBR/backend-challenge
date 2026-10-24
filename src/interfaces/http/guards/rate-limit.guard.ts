import type { AuthenticatedHttpRequest } from "@interfaces/http/guards/provider-auth.guard";
import type { ClientRateLimitState, RateLimitRule } from "@interfaces/http/guards/rate-limit.types";
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Response } from "express";

const DEFAULT_RATE_LIMIT_RULE: RateLimitRule = {
  windowMs: 60_000,
  maxRequests: 120,
};

const ROUTE_RATE_LIMIT_RULES: Readonly<Record<string, RateLimitRule>> = {
  "/wagering/transactions": {
    windowMs: 60_000,
    maxRequests: 60,
  },
  "/wallets": {
    windowMs: 60_000,
    maxRequests: 60,
  },
};

const EXEMPT_PATH_PREFIXES = ["/health", "/metrics", "/docs"] as const;

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly stateMap = new Map<string, ClientRateLimitState>();

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const req = http.getRequest<AuthenticatedHttpRequest>();
    const res = http.getResponse<Response>();

    const path = req.path ?? req.url ?? "";
    const isExempt = EXEMPT_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (isExempt) {
      return true;
    }

    const rule = this.resolveRuleForPath(path);
    const key = this.resolveClientKey(req, path);
    const now = Date.now();

    const currentState = this.stateMap.get(key) ?? { timestamps: [] };
    const cutoff = now - rule.windowMs;
    const activeTimestamps = currentState.timestamps.filter((ts) => ts > cutoff);

    if (activeTimestamps.length >= rule.maxRequests) {
      const oldestActive = activeTimestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestActive + rule.windowMs - now) / 1000));

      res.setHeader("Retry-After", retryAfterSec.toString());
      res.setHeader("X-RateLimit-Limit", rule.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader(
        "X-RateLimit-Reset",
        Math.ceil((oldestActive + rule.windowMs) / 1000).toString(),
      );

      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: "Too Many Requests",
          message: "Rate limit exceeded. Please retry after the cooldown period.",
          retryAfter: retryAfterSec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    activeTimestamps.push(now);
    this.stateMap.set(key, { timestamps: activeTimestamps });

    const remaining = Math.max(0, rule.maxRequests - activeTimestamps.length);
    res.setHeader("X-RateLimit-Limit", rule.maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil((now + rule.windowMs) / 1000).toString());

    return true;
  }

  reset(): void {
    this.stateMap.clear();
  }

  private resolveRuleForPath(path: string): RateLimitRule {
    const matchedRule = Object.entries(ROUTE_RATE_LIMIT_RULES).find(([prefix]) =>
      path.startsWith(prefix),
    );
    return matchedRule !== undefined ? matchedRule[1] : DEFAULT_RATE_LIMIT_RULE;
  }

  private resolveClientKey(req: AuthenticatedHttpRequest, path: string): string {
    const providerId = req.providerPrincipal?.providerId ?? req.headers["x-provider-id"];
    const resolvedProvider = Array.isArray(providerId) ? providerId[0] : providerId;
    const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown-client";
    const clientId =
      resolvedProvider !== undefined && resolvedProvider.trim().length > 0
        ? `provider:${resolvedProvider.trim()}`
        : `ip:${ip}`;

    const routeCategory = path.startsWith("/wagering/transactions")
      ? "wagering"
      : path.startsWith("/wallets")
        ? "wallets"
        : "general";

    return `${clientId}:${routeCategory}`;
  }
}
