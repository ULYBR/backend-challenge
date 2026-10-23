# Centralized Terraform Locals Pattern for DRY, multi-region agility and naming governance
# Adheres to HashiCorp Terraform Best Practices

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name_prefix = "${var.project_name}-${var.environment}"

  # Dynamic AZ selection for multi-region agility (e.g. us-east-1, sa-east-1, eu-west-1)
  # Dynamically selects up to 3 available AZs in whichever region is chosen via var.aws_region
  azs = slice(
    data.aws_availability_zones.available.names,
    0,
    min(3, length(data.aws_availability_zones.available.names))
  )

  # Centralized FinOps, SecOps and Governance tagging applied across all resources
  common_tags = {
    Project     = var.project_name
    Environment = var.environment
    ManagedBy   = "terraform"
    Region      = var.aws_region
    Workload    = "distributed-wagering-processor"
    Compliance  = "pci-dss-financial-grade"
  }

  # Standardized resource identifiers
  vpc_name     = "${local.name_prefix}-vpc"
  cluster_name = "${local.name_prefix}-cluster"
  rds_name     = "${local.name_prefix}-pg17"
  ecr_name     = "${local.name_prefix}-app"
  kms_alias    = "alias/${local.name_prefix}"

  # Enterprise SQS Queue Naming Convention:
  # <project>-<environment>-<domain>-<purpose>[.fifo]
  sqs_inbound_name = "${local.name_prefix}-transactions-inbound.fifo"
  sqs_dlq_name     = "${local.name_prefix}-transactions-dlq.fifo"
  sqs_events_name  = "${local.name_prefix}-wallet-events.fifo"
}
