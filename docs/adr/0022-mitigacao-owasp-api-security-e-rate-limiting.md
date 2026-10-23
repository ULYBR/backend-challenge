---
status: Accepted
date: 2026-10-23
deciders: [Time de Engenharia]
rfc: RFC-0005
---

# ADR-0022 — Mitigação OWASP API Security Top 10 e Rate Limiting Defensivo

## Contexto e problema

APIs financeiras e de processamento de apostas distribuídas são alvos críticos de ataques de automação hostil, negação de serviço econômica (Financial Denial of Service - FDoS), esgotamento de recursos de banco de dados e exploração de fluxos de negócio. 
Embora o sistema possua garantias fortes de integridade transacional (append-only ledger imutável, Money em centavos inteiros e idempotência criptográfica via SHA-256), a ausência de controles de vazão (Rate Limiting) e cabeçalhos de segurança HTTP expõe a API aos riscos catalogados no **OWASP API Security Top 10 (2023)** e **OWASP Top 10 (2021/2025)**.

## Drivers da decisão

- **API4:2023 (Unrestricted Resource Consumption)**: Proteger CPU, conexões de banco de dados PostgreSQL e capacidade do runtime Bun contra inundações volumétricas.
- **API6:2023 (Unrestricted Access to Sensitive Business Flows)**: Mitigar microapostas automatizadas maliciosas, ataques de força bruta e sobrecarga de locks pessimistas em hot wallets.
- **API8:2023 (Security Misconfiguration)**: Injetar cabeçalhos de segurança HTTP recomendados pelo OWASP Secure Headers Project (HSTS, CSP, X-Frame-Options, X-Content-Type-Options).
- **Padronização RFC 6585**: Fornecer feedback padronizado aos clientes HTTP quando a cota for atingida (`HTTP 429 Too Many Requests`, `Retry-After`, `X-RateLimit-*`).
- **Defesa em Profundidade**: Proteger tanto na camada de borda (Kubernetes Ingress / AWS WAF) quanto no nível de aplicação (NestJS Guards por Provider e IP).

## Mapeamento de Mitigações — OWASP API Security Top 10 (2023)

| Vulnerabilidade OWASP | Risco Específico em Apostas | Mecanismo de Mitigação Implementado |
| :--- | :--- | :--- |
| **API1:2023 Broken Object Level Authorization** | Um provedor acessar transações ou carteiras de outro. | `ProviderAuthGuard` associado a escopos e validação de `providerId` obrigatório em todo o pipeline. |
| **API2:2023 Broken Authentication** | Forja de identidade de provedores de jogos. | Ponto de extensão para validação OIDC / HMAC SHA-256 no `ProviderAuthGuard`. |
| **API3:2023 Broken Object Property Level Auth** | Mass assignment de campos financeiros ou status de aposta. | `ZodValidationPipe` com schemas estritos (`.strict()`) que rejeitam propriedades desconhecidas e impedem injeção de `status` ou `walletVersion`. |
| **API4:2023 Unrestricted Resource Consumption** | Inundação de requisições sobrecarregando o banco e memória. | **`RateLimitGuard` com janela deslizante (Sliding Window)**, limite de payload JSON em 1MB e limite máximo de paginação de ledger em 100 registros. |
| **API5:2023 Broken Function Level Authorization** | Provedor comum disparar reconciliações administrativas. | Endpoints sensíveis como `POST /wallets/:id/reconcile` restritos por escopos administrativos. |
| **API6:2023 Unrestricted Access to Sensitive Flows** | Bots realizando microapostas ou tentando race conditions. | Rate limit específico para apostas, **Idempotência Criptográfica (`CanonicalPayloadHasher`)** e **Lock Pessimista (`SELECT FOR UPDATE`)**. |
| **API7:2023 Server Side Request Forgery (SSRF)** | API ser induzida a fazer requisições para a rede interna. | Zero webhooks dinâmicos aceitos via input externo; toda mensageria é restrita ao Amazon SQS interno. |
| **API8:2023 Security Misconfiguration** | Clickjacking, MIME sniffing, CORS aberto, vazamento de stack. | **`SecurityHeadersMiddleware` (HSTS, CSP, X-Frame-Options, no-sniff)**, CORS restrito e `DomainExceptionFilter` sanitizando erros. |
| **API9:2023 Improper Inventory Management** | Endpoints legados ou versões vulneráveis expostas. | APIs documentadas, rotas explícitas nos Controllers do NestJS e healthchecks dedicados. |
| **API10:2023 Unsafe Consumption of APIs** | Dependências vulneráveis de terceiros ou SQS malicioso. | `Trivy` no CI para análise de SBOM/CVEs e validação estrita de esquema Zod nas mensagens SQS. |

## Opções consideradas

1. **Apenas Rate Limiting no API Gateway / Ingress**: Delega ao NGINX/AWS WAF, mas é cego para a identidade do Provedor (`x-provider-id`) e dados da camada de aplicação.
2. **Apenas Rate Limiting no NestJS em memória**: Protege por Provedor/IP na aplicação, mas consome conexões HTTP do pod antes de descartar o tráfego em ataques DDoS em massa.
3. **Defesa em Profundidade (Borda + Aplicação)**: Ingress com anotações de rate limiting e WAF para proteção volumétrica + `RateLimitGuard` na aplicação para rate limiting por Provedor e rota financeira sensível + `SecurityHeadersMiddleware`.

## Decisão

Escolhemos a **Opção 3 (Defesa em Profundidade)**:
1. **Na Aplicação**:
   - Criar `RateLimitGuard` com algoritmo de janela deslizante (Sliding Window) em memória, identificando a origem por `providerId` (quando autenticado) ou IP remoto.
   - Definir limites estritos:
     - Endpoints de apostas e criação de carteira: 60 requisições por minuto por chave.
     - Endpoints de consulta: 120 requisições por minuto por chave.
     - Métricas e healthchecks: isentos ou limite elástico.
   - Em caso de estouro de cota, responder `HTTP 429 Too Many Requests` com cabeçalhos `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` e `X-RateLimit-Reset`.
   - Adicionar `SecurityHeadersMiddleware` injetando HSTS, CSP, X-Frame-Options, X-Content-Type-Options e Referrer-Policy.
   - Limitar o corpo de requisições JSON a `1mb` no `main.ts` e habilitar CORS seguro.
2. **Na Borda (Kubernetes Helm Chart)**:
   - Configurar anotações de rate limit no Ingress (`limit-rps: 100`, `limit-connections: 20`).

## Consequências

### Positivas

- Protege o PostgreSQL contra exaustão de pool de conexões sob ataques volumétricos.
- Impede que um único provedor mal configurado cause negação de serviço em outros provedores da plataforma.
- Bloqueia ataques de clickjacking, sniffing de MIME types e força navegação estritamente sobre HTTPS (HSTS).
- Mantém conformidade técnica com OWASP API Security Top 10 e RFC 6585.

### Negativas / trade-offs

- Em caso de múltiplos pods de API sem um Redis compartilhado, a contagem de janela deslizante em memória opera por réplica de pod (mitigado pelo escalonamento horizontal e sticky routing do Ingress, com interface preparada para adapter Redis caso distribuído).

### Como validar

- Testes unitários comprovando que:
  - Requisições dentro da cota retornam HTTP 2xx e decrementam o cabeçalho `X-RateLimit-Remaining`.
  - Requisições além da cota são rejeitadas com HTTP 429 e cabeçalho `Retry-After`.
  - Passado o tempo da janela, a cota é restaurada.
  - Todas as respostas HTTP contêm os cabeçalhos de segurança recomendados pelo OWASP.

## Prós e contras das opções

### Opção 3 (Defesa em Profundidade - Escolhida)
- **Bom**: Protege tanto a infraestrutura de rede quanto as regras de negócio financeiras contextuais por provedor.
- **Ruim**: Requer manutenção de configurações no Helm e no código NestJS.

## Referências

- [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/)
- [OWASP Secure Headers Project](https://owasp.org/www-project-secure-headers/)
- [RFC 6585: Additional HTTP Status Codes (Status 429)](https://datatracker.ietf.org/doc/html/rfc6585)
