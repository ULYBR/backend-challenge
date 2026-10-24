# TESTING.md — Diretrizes de Engenharia de Testes e Prevenção de Regressão

Este documento é a referência oficial para humanos e agentes de IA sobre **como escrever testes eficazes, concisos e com alto sinal de valor** neste repositório.

O objetivo não é inflar linhas de código ou buscar cobertura artificial de 100%, mas garantir **corretude financeira, ausência de bugs silenciosos e blindagem contra regressão**.

---

## 1. Filosofia: Sinal vs. Ruído (Signal-to-Noise Ratio)

Muitos testes gerados por agentes de IA pecam pelo excesso de texto e falta de eficácia: criam dezenas de cenários repetitivos, cheios de mocks complexos, que passam sempre mas não pegam bugs reais.

### O que é um BOM teste:
1. **Testa Comportamento e Invariantes, não Implementação:** Testa o que o sistema entrega na borda pública, não variáveis privadas ou chamadas de métodos intermediários. Se você refatorar o código interno sem mudar a regra de negócio, o teste **não** deve quebrar.
2. **Falha pelo Motivo Certo:** Se alguém alterar uma regra financeira, o teste quebra com uma mensagem clara e autoexplicativa.
3. **Alta Densidade de Valor (Conciso):** Usa 5 a 15 linhas no padrão **AAA (Arrange, Act, Assert)** sem setups gigantescos ou ruído visual.
4. **Determinístico:** Não depende de timeouts arbitrários (`sleep`), ordem de execução ou estado compartilhado entre testes.

### O que é um TESTE RUIM (Proibido para Agentes):
- ❌ **Tautológico:** Mockar um método para retornar `X` e fazer asserção se o método retornou `X`.
- ❌ **Asserções Fracas:** Fazer apenas `expect(result).toBeDefined()` em vez de verificar o estado financeiro exato.
- ❌ **Testar Getters/Setters ou Tipagens:** Testes triviais que só existem para "aumentar cobertura".
- ❌ **Setups Gigantescos Duplicados:** Repetir dezenas de linhas montando objetos (use os helpers e factories em `test/fixtures/` ou `test/helpers/`).

---

## 2. O Protocolo do "Bug Silencioso" e Regressão (Bug-to-Test)

Quando um bug é reportado ou descoberto em produção/revisão, o agente **está proibido de corrigir o código imediatamente**.

O fluxo mandatório é o ciclo **Reproduce $\rightarrow$ Fix $\rightarrow$ Permanent Guard**:

```
 ┌──────────────────────┐
 │ 1. Reproduzir (RED)  │ ──> Escreva um teste que replica o bug silencioso.
 └──────────┬───────────┘     O teste DEVE FALHAR comprovando a existência do bug.
            │
            ▼
 ┌──────────────────────┐
 │ 2. Corrigir (GREEN)  │ ──> Aplique a correção mínima necessária no código.
 └──────────┬───────────┘     O teste agora DEVE PASSAR sem quebrar nenhum teste anterior.
            │
            ▼
 ┌──────────────────────┐
 │ 3. Blindar (GUARD)   │ ──> O teste é promovido a sentinela permanente no diretório correto,
 └──────────────────────┘     garantindo que o bug nunca mais retorne.
```

### Como nomear testes de regressão:
O nome do teste deve descrever a anomalia silenciosa e o comportamento esperado:
```typescript
it("reproduces and prevents regression: concurrent bet and refund does not credit double balance", async () => { ... });
```

---

## 3. Design de Testes Enxutos com Sintaxe EARS (Inspirado no TLC Spec-Driven)

Uma das maiores fontes de testes prolixos gerados por agentes é a falta de uma especificação formal do comportamento esperado. Quando o requisito é vago, o agente inventa dezenas de testes redundantes e cheios de texto inútil.

Para criar testes cirúrgicos e de alto sinal, adote a sintaxe **EARS (*Easy Approach to Requirements Syntax*)**, amplamente utilizada em engenharia orientada a especificações:

| Padrão EARS | Estrutura da Regra | Tradução Direta para o Teste (`it(...)`) |
| :--- | :--- | :--- |
| **Ubíquo (Invariante)** | O sistema DEVE sempre manter [invariante]. | `it("maintains invariant: wallet balance always matches ledger sum")` |
| **Orientado a Evento** | **WHEN** [evento ocorrer], o sistema **SHALL** [resultado]. | `it("WHEN bet is processed SHALL debit balance and emit event")` |
| **Orientado a Estado** | **WHILE** [em determinado estado], o sistema **SHALL** [resultado]. | `it("WHILE transaction is in terminal state SHALL reject re-transition")` |
| **Comportamento Indesejado (Falhas)** | **IF** [condição inválida], **THEN** o sistema **SHALL** [tratar erro]. | `it("IF payload has divergent hash THEN SHALL reject with 409 Conflict")` |

### Benefício:
Ao derivar o teste diretamente da regra EARS:
- O teste tem de **5 a 10 linhas** no máximo.
- O `it(...)` descreve exatamente o gatilho e a asserção esperada.
- Elimina completamente testes tautológicos e boilerplates inflados de texto.

---

## 4. As 4 Camadas de Teste (Divisão Semântica)

Para evitar duplicar o mesmo teste em vários níveis, cada camada possui um papel exclusivo:

| Camada | Diretório | O que testa? | Velocidade | Dependências Externas |
| :--- | :--- | :--- | :--- | :--- |
| **Unidade** | `test/unit/` | Lógica pura de domínio (`Money`, `Wallet`, `WagerTransaction`, regras de estado, serialização, parsers). | < 300ms | **Zero I/O, zero banco, zero fila.** Proibido mocks de banco aqui; use entidades puras em memória. |
| **Integração** | `test/integration/` | Integração real entre código e infraestrutura: queries SQL, constraints de schema, idempotência de outbox e consumer SQS. | Segundos | **PostgreSQL e SQS (MiniStack) reais em containers.** Mocks de banco ou fila são estritamente proibidos. |
| **Concorrência** | `test/concurrency/` | Paralelismo real com múltiplas conexões/processos: *lost updates*, *race conditions*, 50 requisições simultâneas na mesma wallet. | Segundos | **Infra real com concorrência paralela real** (múltiplas conexões físicas). |
| **Ponta a Ponta (E2E)** | `test/e2e/` | Jornada de ponta a ponta via HTTP: desde a abertura de wallet até o processamento completo de rodadas e liquidação. | Segundos | Servidor HTTP em pé + PostgreSQL + MiniStack. |

---

## 5. Invariante Financeira Obrigatória em Testes de Integração

Em qualquer teste de integração ou concorrência que movimente saldo de carteira, o teste **obrigatoriamente deve terminar validando a equação contábil**:

$$\text{wallet.balance} == \sum(\text{créditos do ledger}) - \sum(\text{débitos do ledger})$$

```typescript
// Exemplo de encerramento obrigatório em testes financeiros:
const ledgerBalance = await ledgerRepo.calculateBalanceFromEntries(wallet.id);
expect(wallet.balance.equals(ledgerBalance)).toBe(true);
```

Se o saldo da carteira divergir do somatório histórico do ledger, o teste deve falhar imediatamente.

---

## 6. Anti-Padrões e Regras de Estilo para Código de Teste

1. **Zero Comentários em `.ts`:**
   * Código de teste também é código de produção do ponto de vista de manutenção.
   * Não use comentários inline `// Arrange`, `// Act`, `// Assert`. A estrutura do teste deve ser intuitiva por si só.
2. **Imports via Path Alias (`@`):**
   * Use `@domain/*`, `@application/*`, `@test/*`. Nunca use `../` ou `./`.
3. **Use Helpers de Teste:**
   * Para criar entidades e dados de teste, reaproveite as fábricas em `test/fixtures/` ou métodos estáticos `create`/`rehydrate` do próprio domínio.
4. **Mensagens de Erro Ricas em Asserções:**
   * Prefira asserções exatas: `expect(wallet.balance.amount).toBe("75.00")` em vez de `expect(wallet.balance.isPositive()).toBe(true)`.

