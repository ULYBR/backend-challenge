import { PendingReferenceWorker } from "@infrastructure/messaging/pending-reference.worker";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [PendingReferenceWorker],
  exports: [PendingReferenceWorker],
})
export class SchedulerWorkerModule {}
