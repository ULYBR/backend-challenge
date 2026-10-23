---
status: Accepted
date: 2026-10-23
deciders: [Ulysses Andrade Leal]
rfc: RFC-0011
---

# ADR-0024 — Incluir Diagramas de Fluxo e Sequência na Documentação OpenAPI

## Contexto e problema

O desafio exige a demonstração clara de garantias financeiras complexas (lock pessimista na carteira, deduplicação persistente via chave e hash canônico SHA-256, append-only ledger imutável, transactional outbox e concorrência distribuída sob múltiplas instâncias). 

Apenas contratos de parâmetros e respostas em JSON não comunicam visualmente a arquitetura e as garantias ACID que ocorrem nos bastidores de cada endpoint (ex.: onde ocorre o lock `FOR UPDATE`, quando a outbox é persistida, como transaciona o status de uma referência pendente).

Precisamos definir como enriquecer a documentação OpenAPI pública e operacional com diagramas de fluxo de alta qualidade sem quebrar compatibilidade, sem introduzir bibliotecas pesadas de compilação gráfica em tempo de execução e sem violar as restrições rígidas de Content-Security-Policy (CSP).

## Drivers da decisão

- **Clareza para o avaliador técnico:** Demonstrar imediatamente a conformidade com as seções 6, 7, 8, 9 e 10 do enunciado do desafio.
- **Portabilidade e compatibilidade:** Os diagramas devem renderizar idênticos no ReDoc, no Swagger UI, em exportações JSON e em editores de Markdown/IDE.
- **Performance e resiliência:** Zero dependência de CDNs externas de renderização gráfica ou scripts pesados no navegador que poderiam ser bloqueados por políticas de segurança.
- **Regras do projeto:** Zero comentários em código `.ts` e documentação centralizada e descritiva.

## Opções consideradas

1. **Injeção de script Mermaid dinâmico no HTML do ReDoc:**
   - *Prós:* Gera gráficos SVG interativos.
   - *Contras:* Apresenta problemas conhecidos de timing com a montagem do React/Virtual DOM do ReDoc; exige permissões inseguras de script sob CSP; não funciona se a especificação for aberta no Swagger UI clássico ou Postman.
2. **Geração prévia de imagens SVG/PNG hospedadas externamente:**
   - *Prós:* Diagramas visuais coloridos.
   - *Contras:* Dependência de storage de assets ou rede externa; quebra em ambientes restritos ou offline; quebra se os arquivos forem movidos.
3. **Diagramas de sequência estruturados em blocos monospaçados Unicode diretamente nas descrições OpenAPI:**
   - *Prós:* 100% autossuficiente e universal; funciona instantaneamente no ReDoc, no Swagger UI, no Postman e na linha de comando (`curl`); zero impacto de segurança/CSP; visual limpo, técnico e corporativo.
   - *Contras:* Estilo minimalista ASCII/Unicode em vez de diagramas com formas coloridas.

## Decisão

Escolhemos a **Opção 3 (Diagramas de sequência estruturados em blocos monospaçados Unicode nas descrições OpenAPI)**, complementados com a documentação formal em Mermaid no repositório ([RFC-0011](../rfc/RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md) e [ARCHITECTURE.md](../../ARCHITECTURE.md)) e padronizados pela skill `.agents/skills/document-api/SKILL.md`.

Adotamos a regra fundamental de **Information Hiding**:
1. **Público (ReDoc):** Visão estritamente black-box. É proibido vazar detalhes internos como queries SQL (`SELECT FOR UPDATE`), tabelas internas (`wager_tx`, `wallet_ledger_entries`), locks de banco ou workers assíncronos. O foco é o protocolo do parceiro, idempotência e resultados de negócio.
2. **Privado/Operacional (Swagger UI):** Visão white-box para governança, auditoria contábil e SRE (`/wallets/:id/reconcile`, probes de saúde e métricas).

Cada endpoint das especificações passa a conter uma seção dedicada de fluxo:
- `POST /v1/api/wallets`: Abertura atômica da carteira, asserção de unicidade do jogador e crédito inicial (visão black-box).
- `GET /v1/api/wallets/{id}/ledger`: Decodificação do cursor opaco base64 e paginação determinística keyset de extrato (visão black-box).
- `POST /v1/api/wagering/transactions`: Ciclo de vida da transação com rate limit, hash canônico, liquidação atômica e resolução out-of-order `202 Accepted` (visão black-box).
- `POST /v1/api/wallets/{id}/reconcile`: Auditoria com lock exclusivo, replay histórico do ledger e autocorreção de saldo em caso de divergência (visão white-box).

## Consequências

### Positivas
- Alta clareza técnica imediata para avaliadores e desenvolvedores integradores.
- Zero dependência externa ou riscos de quebra por CSP.
- Funciona perfeitamente em modo claro e escuro em qualquer cliente HTTP ou visualizador de OpenAPI.
- Totalmente aderente ao padrão de zero comentários em `.ts` (documentação reside na camada de especificação declarativa).

### Negativas / trade-offs
- Aumento de cerca de 4 KB no payload total do arquivo OpenAPI JSON retornado pelos endpoints `/v1/api/docs/public/openapi.json` e `/v1/api/docs/private/openapi.json` (impacto desprezível para endpoints de documentação).

### Como validar
- Testes de unidade em [test/unit/interfaces/docs-controller.spec.ts](../../test/unit/interfaces/docs-controller.spec.ts) validando a presença das seções de fluxo nas descrições de cada rota.
- Inspeção visual automatizada via Chrome Headless confirmando renderização nítida no ReDoc e Swagger UI.

## Referências

- [RFC-0011 — Diagramas de Fluxo e Sequência na Documentação OpenAPI](../rfc/RFC-0011-diagramas-de-fluxo-na-documentacao-openapi.md)
- [ADR-0010 — Máquina de Estados e Políticas Declarativas no Domínio](0010-maquina-de-estados-e-politicas-declarativas-no-dominio.md)
- [ADR-0011 — Lock Pessimista por Wallet com Defesa em Profundidade](0011-usar-lock-pessimista-por-wallet-com-defesa-em-profundidade.md)
- [ADR-0012 — Idempotência Persistente e Hash Canônico SHA-256](0012-garantir-idempotencia-persistente-e-hash-canonico-sha256.md)
- [ADR-0014 — Política de Reversão Única e Validação de Referência](0014-aplicar-politica-de-reversao-unica-e-validacao-de-referencia.md)
