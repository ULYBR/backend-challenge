output "eks_cluster_endpoint" {
  description = "Kubernetes API endpoint for the Amazon EKS cluster"
  value       = aws_eks_cluster.main.endpoint
}

output "eks_cluster_name" {
  description = "Amazon EKS Cluster name where wagering processor Helm chart and Pods are deployed"
  value       = aws_eks_cluster.main.name
}

output "rds_proxy_endpoint" {
  description = "RDS Proxy endpoint used by all auto-scaled EKS Pod roles"
  value       = aws_db_proxy.postgres.endpoint
}

output "wager_transactions_queue_url" {
  description = "SQS FIFO URL for incoming wager transactions"
  value       = aws_sqs_queue.wager_transactions.url
}

output "wager_transactions_dlq_url" {
  description = "SQS FIFO Dead Letter Queue URL"
  value       = aws_sqs_queue.wager_dlq.url
}

output "wallet_events_queue_url" {
  description = "SQS FIFO URL for published integration events from Transactional Outbox"
  value       = aws_sqs_queue.wallet_events.url
}

output "ecr_repository_url" {
  description = "Amazon ECR Repository URL for building and pushing the unified Docker image"
  value       = aws_ecr_repository.app.repository_url
}

output "github_actions_role_arn" {
  description = "IAM Role ARN to be configured in GitHub Secrets as AWS_ROLE_ARN for keyless CI/CD"
  value       = aws_iam_role.github_actions_ecr_push.arn
}

output "acm_certificate_arn" {
  description = "ACM Certificate ARN for the custom domain (if domain_name is provided)"
  value       = local.has_custom_domain ? aws_acm_certificate.api[0].arn : null
}

output "api_custom_hostname" {
  description = "Public HTTPS hostname for accessing the API over the internet"
  value       = local.full_api_hostname
}


