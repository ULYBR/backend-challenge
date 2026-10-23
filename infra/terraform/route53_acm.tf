# Route53 Public DNS and AWS Certificate Manager (ACM) for Custom Domain
# Conditionally provisioned when var.domain_name is provided

locals {
  has_custom_domain = var.domain_name != ""
  full_api_hostname = local.has_custom_domain ? "${var.api_subdomain}.${var.domain_name}" : ""
}

data "aws_route53_zone" "existing" {
  count        = local.has_custom_domain ? 1 : 0
  name         = var.domain_name
  private_zone = false
}

resource "aws_acm_certificate" "api" {
  count             = local.has_custom_domain ? 1 : 0
  domain_name       = local.full_api_hostname
  validation_method = "DNS"

  subject_alternative_names = [
    "*.${var.domain_name}"
  ]

  tags = merge(local.common_tags, {
    Name = "${var.project_name}-api-cert"
  })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cert_validation" {
  for_each = local.has_custom_domain ? {
    for dvo in aws_acm_certificate.api[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = data.aws_route53_zone.existing[0].zone_id
}

resource "aws_acm_certificate_validation" "api" {
  count                   = local.has_custom_domain ? 1 : 0
  certificate_arn         = aws_acm_certificate.api[0].arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}
