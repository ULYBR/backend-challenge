import { OutboxPublisherWorker } from "@infrastructure/messaging/outbox-publisher.worker";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [OutboxPublisherWorker],
  exports: [OutboxPublisherWorker],
})
export class OutboxWorkerModule {}
