import { DomainExceptionFilter } from "@interfaces/http/filters/domain-exception.filter";
import { ProviderAuthGuard } from "@interfaces/http/guards/provider-auth.guard";
import { CorrelationIdInterceptor } from "@interfaces/http/interceptors/correlation-id.interceptor";
import { WageringTransactionsController } from "@interfaces/http/wagering-transactions.controller";
import { WalletsController } from "@interfaces/http/wallets.controller";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

@Module({
  controllers: [WalletsController, WageringTransactionsController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ProviderAuthGuard,
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
export class HttpApiModule {}
