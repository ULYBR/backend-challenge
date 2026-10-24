# infra/terraform/audit.tf
# Trilha de Auditoria Fiscalizatória em Apache Parquet no S3 com AWS Athena

resource "aws_s3_bucket" "audit_logs" {
  bucket        = "${var.project_name}-audit-logs-${var.environment}"
  force_destroy = false

  tags = merge(local.common_tags, {
    Name       = "${var.project_name}-audit-logs-${var.environment}"
    Compliance = "SPA-MF-PCI-DSS"
    DataType   = "AuditTrail"
  })
}

resource "aws_s3_bucket_versioning" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.main.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "audit_logs" {
  bucket = aws_s3_bucket.audit_logs.id

  rule {
    id     = "archive-audit-logs"
    status = "Enabled"

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }
  }
}

# AWS Athena Database e Queries de Fiscalização
resource "aws_athena_database" "audit_db" {
  name   = "wagering_audit_${var.environment}"
  bucket = aws_s3_bucket.audit_logs.id
}

resource "aws_athena_named_query" "fiscalizacao_por_provedor" {
  name        = "Fiscalizacao-Por-Provedor"
  database    = aws_athena_database.audit_db.name
  description = "Agrupamento de requisicoes, codigos HTTP e latencia por Provedor de Jogos"

  query = <<-SQL
    SELECT 
      provider_id,
      status_code,
      count(*) AS total_requisicoes,
      round(avg(duration_ms), 2) AS latencia_media_ms,
      min(timestamp) AS primeira_chamada,
      max(timestamp) AS ultima_chamada
    FROM wagering_audit_${var.environment}.access_logs
    WHERE year = cast(year(current_date) as varchar)
      AND month = lpad(cast(month(current_date) as varchar), 2, '0')
    GROUP BY provider_id, status_code
    ORDER BY total_requisicoes DESC;
  SQL
}

resource "aws_athena_named_query" "fiscalizacao_por_ip" {
  name        = "Fiscalizacao-Por-IP-Suspeito"
  database    = aws_athena_database.audit_db.name
  description = "Identificacao de IPs com alta taxa de 422 (Unprocessable) ou 429 (Rate Limit)"

  query = <<-SQL
    SELECT 
      client_ip,
      provider_id,
      status_code,
      count(*) AS total_ocorrencias,
      max(timestamp) AS ultima_ocorrencia
    FROM wagering_audit_${var.environment}.access_logs
    WHERE status_code IN (409, 422, 429)
    GROUP BY client_ip, provider_id, status_code
    HAVING count(*) >= 10
    ORDER BY total_ocorrencias DESC;
  SQL
}

