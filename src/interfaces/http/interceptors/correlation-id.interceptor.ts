import type { IdGeneratorPort } from "@application/ports/id-generator.port";
import { TOKENS } from "@application/ports/tokens";
import { CorrelationContext } from "@infrastructure/observability/correlation-context";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable } from "rxjs";

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  constructor(@Inject(TOKENS.ID_GENERATOR) private readonly idGenerator: IdGeneratorPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const headerValue = request.headers["x-correlation-id"];
    const incomingCorrelationId = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const correlationId =
      incomingCorrelationId !== undefined && incomingCorrelationId.trim().length > 0
        ? incomingCorrelationId.trim()
        : this.idGenerator.generate();

    response.setHeader("x-correlation-id", correlationId);

    return CorrelationContext.run({ correlationId }, () => next.handle());
  }
}
