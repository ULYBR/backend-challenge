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

