---
status: Accepted
date: 2026-10-23
deciders: [Ulysses Andrade Leal]
rfc: RFC-0010
---

# ADR-0023 — Adotar prefixo /api/v1 com compatibilidade reversa e documentação dual ReDoc e Swagger UI

## Contexto e problema

A Seção 9 de `docs/challenge/CHALLENGE.md` define as operações REST da carteira e transações financeiras (`/wallets`, `/wagering/transactions`).
No entanto, no mercado financeiro e de iGaming, APIs produtivas utilizam namespaces versionados explícitos (`/api/v1/...`) para segregação de ciclo de vida e proteção contra breaking changes.
Além disso, a documentação pública para desenvolvedores de provedores de jogos requer um padrão visual de excelência (3 colunas, geração de cURL, tipagem detalhada de schemas — padrão ReDoc utilizado por empresas como Zé Delivery, Docker e Ambev), enquanto engenheiros e avaliadores necessitam de um console interativo operacional (Swagger UI com o recurso *"Try it out"*).

## Drivers da decisão

- **Padrão de mercado**: Versionamento explícito de rotas HTTP em `/api/v1/...`.
- **Compatibilidade não-destrutiva**: Preservar funcionamento transparente para requisições legadas em `/wallets` sem quebrar testes anteriores.
- **Experiência do desenvolvedor**: Oferecer ReDoc para apresentação técnica e leitura de contratos e Swagger UI para testes manuais interativos no navegador.
- **Zero HTML manual em controllers**: Eliminar strings HTML concatenadas e templates manuais em código de backend.
- **Segurança**: Ajustar a Content-Security-Policy (CSP) estritamente para os recursos necessários de documentação (`worker-src 'self' blob:`), mantendo isolamento zero-trust nas rotas financeiras.

## Opções consideradas

1. **Apenas Swagger UI clássico**: Prático para testes, mas com layout de sanfona poluído para documentação pública de desenvolvedores.
2. **Apenas ReDoc**: Excelente apresentação visual em 3 colunas, mas não possui botão de execução direta de requisições (*"Try it out"*) na versão livre.
3. **Documentação Dual (ReDoc em `/docs` + Swagger UI em `/docs/swagger`) com prefixo canônico `/api/v1`**: Combina o melhor dos dois mundos sobre a mesma especificação canônica OpenAPI 3.1.

## Decisão

Escolhemos a **Opção 3**:
1. Adotar `/api/v1` como prefixo global do NestJS com middleware de rewrite transparente para chamadas legadas.
2. Expor o ReDoc standalone oficial em `GET /docs` (layout de 3 colunas padrão Zé Delivery) com âncoras `#operation/...`.
3. Expor o Swagger UI 5.x em `GET /docs/swagger` para execução interativa.
4. Ajustar o `SecurityHeadersMiddleware` para suportar `worker-src 'self' blob:` nas rotas `/docs*`.

## Consequências

### Positivas

- Rotas de negócio padronizadas e versionadas conforme boas práticas de mercado.
- Compatibilidade reversa integral para chamadas legadas em `/wallets` e `/wagering`.
- Apresentação técnica de alto nível no estilo Zé Delivery com deep linking preciso.
- Capacidade do avaliador testar payloads diretamente no navegador via Swagger UI.
- Código limpo, tipado e sem templates manuais misturados em classes do NestJS.

### Negativas / trade-offs

- O middleware de cabeçalhos de segurança precisa de uma regra específica para rotas de `/docs*` para liberar os scripts e web workers do ReDocly e Swagger UI.
- Manutenção do mapeamento de rotas canônicas e legadas.

### Como validar

- Testes unitários em `test/unit/interfaces/docs-controller.spec.ts` e `test/unit/interfaces/security-headers-middleware.spec.ts`.
- Testes de integração HTTP validando respostas tanto em `/api/v1/wallets` quanto em `/wallets`.
- Verificação do cabeçalho `Content-Security-Policy` nas rotas `/docs` e `/api/v1/wallets`.

## Prós e contras das opções

### Opção 1: Apenas Swagger UI clássico

- Bom, porque é nativo do ecossistema e tem botão "Try it out".
- Ruim, porque o layout de sanfona em 1 coluna é visualmente datado e não atende ao padrão de APIs públicas modernas.

### Opção 2: Apenas ReDoc

- Bom, porque o layout de 3 colunas é o padrão ouro de empresas como Zé Delivery, Docker e Stripe.
- Ruim, porque não permite que o usuário teste os endpoints diretamente pelo browser sem abrir ferramentas externas.

### Opção 3: Documentação Dual (ReDoc + Swagger UI)

- Bom, porque entrega tanto a especificação visual impecável quanto o console interativo de execução.
- Ruim, porque exige manter dois pontos de entrada HTML leves e gerenciar a CSP de ambos.

## Referências

- [RFC-0010](../rfc/RFC-0010-padronizacao-rotas-api-v1-e-documentacao-dual-redoc-swagger.md)
- [Documentação Pública Zé Delivery](https://seller-public-api.ze.delivery/docs#operation/arrivedOrder)
- [Redocly Standalone Documentation](https://redocly.com/docs/redoc/quickstart/standalone/)
- [Swagger UI Official Distribution](https://swagger.io/tools/swagger-ui/)
