import { TOKENS } from "@application/ports/tokens";
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  GetQueueUrlCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { AppEnv } from "@infrastructure/config/env";
import { Global, Inject, Module, OnApplicationShutdown } from "@nestjs/common";

export interface SqsQueueUrls {
  readonly wagerQueueUrl: string;
  readonly wagerDlqUrl: string;
  readonly eventsQueueUrl: string;
}

export class SqsQueueRegistry {
  private cachedUrls: SqsQueueUrls | undefined;

  constructor(
    private readonly client: SQSClient,
    private readonly env: AppEnv,
  ) {}

  async ensureQueues(): Promise<SqsQueueUrls> {
    if (this.cachedUrls !== undefined) {
      return this.cachedUrls;
    }

    const isDlqFifo = this.env.SQS_WAGER_DLQ_NAME.endsWith(".fifo");
    const wagerDlqUrl = await this.createOrResolveQueue(
      this.env.SQS_WAGER_DLQ_NAME,
      isDlqFifo ? { FifoQueue: "true", ContentBasedDeduplication: "false" } : {},
    );

    const dlqAttrs = await this.client.send(
      new GetQueueAttributesCommand({
        QueueUrl: wagerDlqUrl,
        AttributeNames: ["QueueArn"],
      }),
    );
    const dlqArn = dlqAttrs.Attributes?.QueueArn;

    const isWagerFifo = this.env.SQS_WAGER_QUEUE_NAME.endsWith(".fifo");
    const wagerAttributes: Record<string, string> = {
      VisibilityTimeout: String(this.env.SQS_VISIBILITY_TIMEOUT_SEC),
      ...(isWagerFifo ? { FifoQueue: "true", ContentBasedDeduplication: "false" } : {}),
    };
    if (dlqArn !== undefined) {
      wagerAttributes.RedrivePolicy = JSON.stringify({
        deadLetterTargetArn: dlqArn,
        maxReceiveCount: String(this.env.SQS_MAX_RECEIVE_COUNT),
      });
    }

    const wagerQueueUrl = await this.createOrResolveQueue(
      this.env.SQS_WAGER_QUEUE_NAME,
      wagerAttributes,
    );

    const isEventsFifo = this.env.SQS_EVENTS_QUEUE_NAME.endsWith(".fifo");
    const eventsQueueUrl = await this.createOrResolveQueue(
      this.env.SQS_EVENTS_QUEUE_NAME,
      isEventsFifo ? { FifoQueue: "true", ContentBasedDeduplication: "false" } : {},
    );

    this.cachedUrls = {
      wagerQueueUrl,
      wagerDlqUrl,
      eventsQueueUrl,
    };
    return this.cachedUrls;
  }

  async checkReadiness(): Promise<SqsQueueUrls> {
    const urls = await this.ensureQueues();
    await Promise.all([
      this.getQueueUrl(this.env.SQS_WAGER_QUEUE_NAME),
      this.getQueueUrl(this.env.SQS_WAGER_DLQ_NAME),
    ]);
    return urls;
  }

  private async createOrResolveQueue(
    queueName: string,
    attributes: Record<string, string>,
  ): Promise<string> {
    try {
      const created = await this.client.send(
        new CreateQueueCommand({
          QueueName: queueName,
          Attributes: attributes,
        }),
      );
      return created.QueueUrl ?? (await this.getQueueUrl(queueName));
    } catch {
      return this.getQueueUrl(queueName);
    }
  }

  private async getQueueUrl(queueName: string): Promise<string> {
    const result = await this.client.send(new GetQueueUrlCommand({ QueueName: queueName }));
    if (result.QueueUrl === undefined) {
      throw new Error(`SQS queue URL not returned for '${queueName}'`);
    }
    return result.QueueUrl;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: TOKENS.SQS_CLIENT,
      inject: [TOKENS.APP_ENV],
      useFactory: (env: AppEnv): SQSClient => {
        return new SQSClient({
          region: env.AWS_REGION,
          endpoint: env.AWS_ENDPOINT_URL,
          credentials: {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          },
        });
      },
    },
    {
      provide: TOKENS.SQS_QUEUE_REGISTRY,
      inject: [TOKENS.SQS_CLIENT, TOKENS.APP_ENV],
      useFactory: (client: SQSClient, env: AppEnv): SqsQueueRegistry => {
        return new SqsQueueRegistry(client, env);
      },
    },
  ],
  exports: [TOKENS.SQS_CLIENT, TOKENS.SQS_QUEUE_REGISTRY],
})
export class SqsModule implements OnApplicationShutdown {
  constructor(@Inject(TOKENS.SQS_CLIENT) private readonly sqsClient: SQSClient) {}

  onApplicationShutdown(): void {
    this.sqsClient.destroy();
  }
}
