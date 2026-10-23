variable "project_name" {
  type        = string
  default     = "wagering-processor"
  description = "Project prefix for AWS resources"
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Deployment environment name"
}

variable "aws_region" {
  type        = string
  default     = "us-east-1"
  description = "Target AWS region"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.42.0.0/16"
  description = "VPC CIDR block"
}

variable "container_image" {
  type        = string
  default     = "wagering-processor:latest"
  description = "ECR image URI for the unified modular monolith container"
}

variable "db_instance_class" {
  type        = string
  default     = "db.r6g.large"
  description = "RDS PostgreSQL 17 instance class"
}

variable "db_username" {
  type        = string
  default     = "wagering"
  description = "Master username for RDS PostgreSQL"
}

variable "db_password" {
  type        = string
  sensitive   = true
  default     = "change-me-in-production-tfvars"
  description = "Master password stored in AWS Secrets Manager for RDS & RDS Proxy"
}

variable "github_repository" {
  type        = string
  default     = "ULYBR/backend-challenge"
  description = "GitHub repository identifier in owner/repo format for OIDC trust"
}

variable "domain_name" {
  type        = string
  default     = ""
  description = "Optional custom root domain for Route53 and ACM (e.g., example.com)"
}

variable "api_subdomain" {
  type        = string
  default     = "api"
  description = "Subdomain prefix for the public wagering API (e.g., api.example.com)"
}


