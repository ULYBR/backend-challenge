import "reflect-metadata";
import type { StructuredLoggerPort } from "@application/ports/structured-logger.port";
import { TOKENS } from "@application/ports/tokens";
import { AppEnv, parseEnv } from "@infrastructure/config/env";
import { SqsQueueRegistry } from "@infrastructure/messaging/sqs.module";
import type { MikroORM } from "@mikro-orm/postgresql";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "@src/app.module";
import type { NextFunction, Request, Response } from "express";
import { Logger } from "nestjs-pino";

type StartupStrategy = (
  app: INestApplication,
  env: AppEnv,
  logger: StructuredLoggerPort,
) => Promise<void>;

const STARTUP_STRATEGIES: Record<"http" | "workerOnly", StartupStrategy> = {
  http: async (app, env, logger) => {
    await app.listen(env.PORT, "0.0.0.0");
    logger.info(
      {
        event: "app.bootstrap.listening",
        port: env.PORT,
        roles: Array.from(env.activeRoles),
      },
      "Distributed Wagering Processor listening",
    );
  },
  workerOnly: async (app, env, logger) => {
    await app.init();
    logger.info(
      {
        event: "app.bootstrap.worker_initialized",
        roles: Array.from(env.activeRoles),
      },
      "Distributed Wagering Processor worker roles initialized",
    );
  },
};

export async function bootstrap(): Promise<INestApplication> {
  const env = parseEnv();
  const app = await NestFactory.create(AppModule.register(env), {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  app.enableCors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Provider-Id",
      "X-Correlation-Id",
      "X-Idempotency-Key",
    ],
  });

  const URL_REWRITE_RULES: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
    { pattern: /^\/(?:v1\/api|api\/v1)\/docs$/, replacement: "/docs" },
    { pattern: /^\/(?:v1\/api|api\/v1)\/docs\/(.*)$/, replacement: "/docs/$1" },
    { pattern: /^\/v1\/api\/(.*)$/, replacement: "/api/v1/$1" },
    { pattern: /^\/(wallets|wagering|providers)(.*)$/, replacement: "/api/v1/$1$2" },
  ];

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const matchedRule = URL_REWRITE_RULES.find((rule) => rule.pattern.test(req.url));
    if (matchedRule !== undefined) {
      req.url = req.url.replace(matchedRule.pattern, matchedRule.replacement);
    }
    next();
  });

  app.setGlobalPrefix("api/v1", {
    exclude: [
      "health",
      "health/(.*)",
      "metrics",
      "docs",
      "docs/(.*)",
      "v1/api/docs",
      "v1/api/docs/(.*)",
      "api/v1/docs",
      "api/v1/docs/(.*)",
    ],
  });

  const orm = app.get<MikroORM>(TOKENS.MIKRO_ORM);
  await orm.getMigrator().up();

  const sqsRegistry = app.get<SqsQueueRegistry>(TOKENS.SQS_QUEUE_REGISTRY);
  await sqsRegistry.ensureQueues();

  const structuredLogger = app.get<StructuredLoggerPort>(TOKENS.LOGGER);
  const mode = env.activeRoles.has("api") ? "http" : "workerOnly";
  await STARTUP_STRATEGIES[mode](app, env, structuredLogger);

  return app;
}

if (import.meta.main) {
  bootstrap().catch((err) => {
    console.error("Fatal error during application bootstrap:", err);
    process.exit(1);
  });
}
