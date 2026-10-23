import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TOKENS } from "@application/ports/tokens";
import { parseEnv } from "@infrastructure/config/env";
import { SqsQueueRegistry } from "@infrastructure/messaging/sqs.module";
import { EntityManager } from "@mikro-orm/postgresql";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";

describe("Phase 1 Infrastructure Spike: NestJS + MikroORM + PostgreSQL + MiniStack SQS", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const env = parseEnv({
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      LOG_LEVEL: "silent",
      APP_ROLE: "api",
    });

    app = await NestFactory.create(AppModule.register(env), {
      logger: false,
    });
    app.enableShutdownHooks();

    const sqsRegistry = app.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
    await sqsRegistry.ensureQueues();

    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });

  afterAll(async () => {
    if (app !== undefined) {
      await app.close();
    }
  });

  it("executes a transactional query on PostgreSQL 17 via MikroORM EntityManager", async () => {
    const em = app.get<EntityManager>(TOKENS.ENTITY_MANAGER);

    const result = await em.transactional(async (txEm) => {
      const rows = await txEm
        .getConnection()
        .execute<Array<{ sum_result: string }>>(
          "SELECT (10.25::numeric(19,2) + 14.75::numeric(19,2))::text AS sum_result",
        );
      return rows[0]?.sum_result;
    });

    expect(result).toBe("25.00");
  });

  it("provisions wager-transactions.fifo, wager-transactions-dlq.fifo and wallet-events.fifo in MiniStack", async () => {
    const sqsRegistry = app.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
    const urls = await sqsRegistry.checkReadiness();

    expect(urls.wagerQueueUrl).toContain("wager-transactions.fifo");
    expect(urls.wagerDlqUrl).toContain("wager-transactions-dlq.fifo");
    expect(urls.eventsQueueUrl).toContain("wallet-events.fifo");
  });

  it("exposes /health/live and /health/ready endpoints", async () => {
    const liveRes = await fetch(`${baseUrl}/health/live`);
    expect(liveRes.status).toBe(200);
    const liveBody = (await liveRes.json()) as { status: string; roles: string[] };
    expect(liveBody.status).toBe("ok");
    expect(liveBody.roles).toEqual(["api"]);

    const readyRes = await fetch(`${baseUrl}/health/ready`);
    expect(readyRes.status).toBe(200);
    const readyBody = (await readyRes.json()) as {
      status: string;
      checks: { postgres: { status: string }; sqs: { status: string } };
    };
    expect(readyBody.status).toBe("ok");
    expect(readyBody.checks.postgres.status).toBe("up");
    expect(readyBody.checks.sqs.status).toBe("up");
  });
});
