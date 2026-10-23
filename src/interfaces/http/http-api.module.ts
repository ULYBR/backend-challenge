import { DomainExceptionFilter } from "@interfaces/http/filters/domain-exception.filter";
import { ProviderAuthGuard } from "@interfaces/http/guards/provider-auth.guard";
import { RateLimitGuard } from "@interfaces/http/guards/rate-limit.guard";
import { CorrelationIdInterceptor } from "@interfaces/http/interceptors/correlation-id.interceptor";
import { SecurityHeadersMiddleware } from "@interfaces/http/middlewares/security-headers.middleware";
import { WageringTransactionsController } from "@interfaces/http/wagering-transactions.controller";
import { WalletsController } from "@interfaces/http/wallets.controller";
import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

@Module({
  controllers: [WalletsController, WageringTransactionsController],
  providers: [
    RateLimitGuard,
    {
      provide: APP_GUARD,
      useClass: ProviderAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_FILTER,
      useClass: DomainExceptionFilter,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CorrelationIdInterceptor,
    },
  ],
})
export class HttpApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SecurityHeadersMiddleware).forRoutes("*");
  }
}
