import { WagerTransactionsSqsConsumer } from "@interfaces/sqs/wager-transactions-sqs.consumer";
import { Global, Module } from "@nestjs/common";

@Global()
@Module({
  providers: [WagerTransactionsSqsConsumer],
  exports: [WagerTransactionsSqsConsumer],
})
export class SqsConsumerModule {}
