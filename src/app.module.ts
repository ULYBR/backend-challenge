import { ApplicationModule } from "@application/application.module";
import { TOKENS } from "@application/ports/tokens";
import { AppEnv, parseEnv } from "@infrastructure/config/env";
import { OutboxWorkerModule } from "@infrastructure/messaging/outbox-worker.module";
import { SchedulerWorkerModule } from "@infrastructure/messaging/scheduler-worker.module";
import { SqsModule } from "@infrastructure/messaging/sqs.module";
import { PrometheusMetricsAdapter } from "@infrastructure/observability/prometheus-metrics.adapter";
import { PinoStructuredLoggerAdapter } from "@infrastructure/observability/structured-logger.adapter";
import { DatabaseModule } from "@infrastructure/persistence/database.module";
import { InMemoryRingBufferAuditTrailAdapter } from "@infrastructure/security/in-memory-ring-buffer-audit-trail.adapter";
import { NoopProviderIdentityAdapter } from "@infrastructure/security/noop-provider-identity.adapter";
import { SystemClockAdapter } from "@infrastructure/system/system-clock.adapter";
import { UuidV7Generator } from "@infrastructure/system/uuid-v7.generator";
import { HealthController } from "@interfaces/http/health.controller";
import { HttpApiModule } from "@interfaces/http/http-api.module";
import { MetricsController } from "@interfaces/http/metrics.controller";
import { SqsConsumerModule } from "@interfaces/sqs/sqs-consumer.module";
import { DynamicModule, Global, Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";

@Global()
@Module({})
export class AppModule {
  static register(customEnv?: AppEnv): DynamicModule {
    const env = customEnv ?? parseEnv();

    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            autoLogging: false,
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.body.money",
                "req.body.initialBalance",
                "res.headers['set-cookie']",
              ],
              censor: "[REDACTED]",
            },
          },
        }),
        DatabaseModule,
        SqsModule,
        ApplicationModule,
        ...(env.activeRoles.has("api") ? [HttpApiModule] : []),
        ...(env.activeRoles.has("consumer") ? [SqsConsumerModule] : []),
        ...(env.activeRoles.has("outbox") ? [OutboxWorkerModule] : []),
        ...(env.activeRoles.has("scheduler") ? [SchedulerWorkerModule] : []),
      ],
      controllers: [HealthController, MetricsController],
      providers: [
        {
          provide: TOKENS.APP_ENV,
          useValue: env,
        },
        {
          provide: TOKENS.LOGGER,
          useClass: PinoStructuredLoggerAdapter,
        },
        {
          provide: TOKENS.CLOCK,
          useClass: SystemClockAdapter,
        },
        {
          provide: TOKENS.ID_GENERATOR,
          useClass: UuidV7Generator,
        },
        {
          provide: TOKENS.METRICS,
          useClass: PrometheusMetricsAdapter,
        },
        {
          provide: TOKENS.PROVIDER_IDENTITY_PORT,
          useClass: NoopProviderIdentityAdapter,
        },
        {
          provide: TOKENS.AUDIT_TRAIL_PORT,
          useFactory: (): InMemoryRingBufferAuditTrailAdapter =>
            new InMemoryRingBufferAuditTrailAdapter(),
        },
      ],
      exports: [
        TOKENS.APP_ENV,
        TOKENS.LOGGER,
        TOKENS.CLOCK,
        TOKENS.ID_GENERATOR,
        TOKENS.METRICS,
        TOKENS.PROVIDER_IDENTITY_PORT,
        TOKENS.AUDIT_TRAIL_PORT,
      ],
    };
  }
}
