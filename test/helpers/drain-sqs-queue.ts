import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  type SQSClient,
} from "@aws-sdk/client-sqs";

export async function drainSqsQueue(client: SQSClient, queueUrl: string): Promise<void> {
  while (true) {
    const res = await client.send(
      new ReceiveMessageCommand({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        WaitTimeSeconds: 0,
      }),
    );
    const messages = res.Messages ?? [];
    if (messages.length === 0) {
      break;
    }

    const entries = messages.flatMap((m, index) => {
      const receiptHandle = m.ReceiptHandle;
      if (!receiptHandle) {
        return [];
      }
      return [
        {
          Id: m.MessageId ?? `drain-${index}`,
          ReceiptHandle: receiptHandle,
        },
      ];
    });

    if (entries.length > 0) {
      await client.send(
        new DeleteMessageBatchCommand({
          QueueUrl: queueUrl,
          Entries: entries,
        }),
      );
    }
  }
}
