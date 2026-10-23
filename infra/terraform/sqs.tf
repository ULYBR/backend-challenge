resource "aws_sqs_queue" "wager_dlq" {
  name                              = local.sqs_dlq_name
  fifo_queue                        = true
  content_based_deduplication       = false
  message_retention_seconds         = 1209600
  kms_master_key_id                 = aws_kms_key.main.arn
  kms_data_key_reuse_period_seconds = 300

  tags = merge(local.common_tags, {
    Domain = "wagering"
    Type   = "dead-letter-queue"
  })
}

resource "aws_sqs_queue" "wager_transactions" {
  name                              = local.sqs_inbound_name
  fifo_queue                        = true
  content_based_deduplication       = false
  deduplication_scope               = "messageGroup"
  fifo_throughput_limit             = "perMessageGroupId"
  visibility_timeout_seconds        = 30
  receive_wait_time_seconds         = 10
  kms_master_key_id                 = aws_kms_key.main.arn
  kms_data_key_reuse_period_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.wager_dlq.arn
    maxReceiveCount     = 5
  })

  tags = merge(local.common_tags, {
    Domain = "wagering"
    Type   = "inbound-transactions"
  })
}

resource "aws_sqs_queue" "wallet_events" {
  name                              = local.sqs_events_name
  fifo_queue                        = true
  content_based_deduplication       = false
  deduplication_scope               = "messageGroup"
  fifo_throughput_limit             = "perMessageGroupId"
  visibility_timeout_seconds        = 30
  kms_master_key_id                 = aws_kms_key.main.arn
  kms_data_key_reuse_period_seconds = 300

  tags = merge(local.common_tags, {
    Domain = "wallet"
    Type   = "integration-events"
  })
}


