import { TOKENS } from "@application/ports/tokens";
import type { AppEnv } from "@infrastructure/config/env";
import { SqsQueueRegistry } from "@infrastructure/messaging/sqs.module";
import { EntityManager } from "@mikro-orm/postgresql";
import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(TOKENS.APP_ENV) private readonly env: AppEnv,
    @Inject(TOKENS.ENTITY_MANAGER) private readonly em: EntityManager,
    @Inject(TOKENS.SQS_QUEUE_REGISTRY) private readonly sqsRegistry: SqsQueueRegistry,
  ) {}

  @Get("live")
  @HttpCode(HttpStatus.OK)
  live() {
    return {
      status: "ok",
      instanceId: this.env.INSTANCE_ID,
      roles: Array.from(this.env.activeRoles),
      timestamp: new Date().toISOString(),
    };
  }

  @Get("ready")
  async ready(@Res() res: Response) {
    const checks: Record<string, { status: "up" | "down"; error?: string }> = {
      postgres: { status: "down" },
      sqs: { status: "down" },
    };

    try {
      await this.em.getConnection().execute("SELECT 1");
      checks.postgres = { status: "up" };
    } catch (err) {
      checks.postgres = {
        status: "down",
        error: err instanceof Error ? err.message : "unknown_database_error",
      };
    }

    try {
      await this.sqsRegistry.checkReadiness();
      checks.sqs = { status: "up" };
    } catch (err) {
      checks.sqs = {
        status: "down",
        error: err instanceof Error ? err.message : "unknown_sqs_error",
      };
    }

    const allHealthy = checks.postgres.status === "up" && checks.sqs.status === "up";
    const statusCode = allHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE;

    return res.status(statusCode).json({
      status: allHealthy ? "ok" : "degraded",
      instanceId: this.env.INSTANCE_ID,
      checks,
      timestamp: new Date().toISOString(),
    });
  }
}
