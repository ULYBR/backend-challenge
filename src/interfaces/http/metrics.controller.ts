import type { MetricsPort } from "@application/ports/metrics.port";
import type { OutboxRepositoryPort } from "@application/ports/outbox-repository.port";
import { TOKENS } from "@application/ports/tokens";
import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from "@nestjs/common";
import type { Response } from "express";

@Controller("metrics")
export class MetricsController {
  constructor(
    @Inject(TOKENS.METRICS) private readonly metrics: MetricsPort,
    @Inject(TOKENS.OUTBOX_REPOSITORY)
    private readonly outboxRepository: OutboxRepositoryPort,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  async getMetrics(@Res() response: Response): Promise<void> {
    const unpublishedCount = await this.outboxRepository.countUnpublished();
    this.metrics.setOutboxLag(unpublishedCount);
    const body = await this.metrics.renderPrometheusMetrics();
    response.setHeader("content-type", this.metrics.getContentType());
    response.send(body);
  }
}
