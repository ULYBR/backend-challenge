resource "aws_secretsmanager_secret" "db_credentials" {
  name                    = "${var.project_name}/${var.environment}/database-credentials"
  description             = "PostgreSQL master and application credentials encrypted via KMS"
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = 7

  tags = {
    Project     = var.project_name
    Environment = var.environment
  }
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    host     = aws_db_proxy.postgres.endpoint
    port     = 5432
    database = var.project_name
    ssl      = "require"
  })
}

