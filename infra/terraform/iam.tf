# Least-Privilege IAM Roles and Policies segregated by APP_ROLE
# Follows AWS Well-Architected Framework: Security Pillar (SEC03)
# Uses EKS IAM Roles for Service Accounts (IRSA) for fine-grained pod identity

# --- Role A: API Role (HTTP Ingestion only) ---
# ZERO SQS permissions; only DB secrets and KMS decrypt
resource "aws_iam_role" "app_role_api" {
  name = "${local.name_prefix}-role-api"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRoleWithWebIdentity"
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:wagering:${local.name_prefix}-api"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "api_least_privilege" {
  name = "${var.project_name}-${var.environment}-policy-api"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowDbSecretAccess"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.db_credentials.arn]
      },
      {
        Sid      = "AllowKmsDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.main.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api_attach" {
  role       = aws_iam_role.app_role_api.name
  policy_arn = aws_iam_policy.api_least_privilege.arn
}

# --- Role B: Consumer Role (SQS Inbound Processing only) ---
# Can ONLY poll transactions-inbound and write to DLQ
resource "aws_iam_role" "app_role_consumer" {
  name = "${local.name_prefix}-role-consumer"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRoleWithWebIdentity"
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:wagering:${local.name_prefix}-consumer"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "consumer_least_privilege" {
  name = "${var.project_name}-${var.environment}-policy-consumer"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ConsumeInboundQueueOnly"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:ChangeMessageVisibility",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [aws_sqs_queue.wager_transactions.arn]
      },
      {
        Sid      = "ForwardToDlqOnly"
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = [aws_sqs_queue.wager_dlq.arn]
      },
      {
        Sid    = "KmsDecryptAndGenerateKeyForSqs"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ]
        Resource = [aws_kms_key.main.arn]
      },
      {
        Sid      = "AllowDbSecretAccess"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.db_credentials.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "consumer_attach" {
  role       = aws_iam_role.app_role_consumer.name
  policy_arn = aws_iam_policy.consumer_least_privilege.arn
}

# --- Role C: Outbox Role (Transactional Outbox Publisher only) ---
# Can ONLY publish to wallet-events.fifo; ZERO read permissions on inbound queue
resource "aws_iam_role" "app_role_outbox" {
  name = "${local.name_prefix}-role-outbox"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRoleWithWebIdentity"
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:wagering:${local.name_prefix}-outbox"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "outbox_least_privilege" {
  name = "${var.project_name}-${var.environment}-policy-outbox"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "PublishEventsOnly"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = [aws_sqs_queue.wallet_events.arn]
      },
      {
        Sid    = "KmsEncryptEvents"
        Effect = "Allow"
        Action = [
          "kms:GenerateDataKey",
          "kms:Encrypt"
        ]
        Resource = [aws_kms_key.main.arn]
      },
      {
        Sid      = "AllowDbSecretAccess"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.db_credentials.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "outbox_attach" {
  role       = aws_iam_role.app_role_outbox.name
  policy_arn = aws_iam_policy.outbox_least_privilege.arn
}

# --- Role D: Scheduler Role (Pending Reference Resolver only) ---
# Operates purely on PostgreSQL; ZERO SQS permissions
resource "aws_iam_role" "app_role_scheduler" {
  name = "${local.name_prefix}-role-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action    = "sts:AssumeRoleWithWebIdentity"
        Effect    = "Allow"
        Principal = { Federated = aws_iam_openid_connect_provider.eks.arn }
        Condition = {
          StringEquals = {
            "${replace(aws_iam_openid_connect_provider.eks.url, "https://", "")}:sub" = "system:serviceaccount:wagering:${local.name_prefix}-scheduler"
          }
        }
      }
    ]
  })

  tags = local.common_tags
}

resource "aws_iam_policy" "scheduler_least_privilege" {
  name = "${var.project_name}-${var.environment}-policy-scheduler"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "AllowDbSecretAccess"
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = [aws_secretsmanager_secret.db_credentials.arn]
      },
      {
        Sid      = "AllowKmsDecrypt"
        Effect   = "Allow"
        Action   = ["kms:Decrypt"]
        Resource = [aws_kms_key.main.arn]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "scheduler_attach" {
  role       = aws_iam_role.app_role_scheduler.name
  policy_arn = aws_iam_policy.scheduler_least_privilege.arn
}

