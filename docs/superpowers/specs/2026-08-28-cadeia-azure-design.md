# Cadeia de Entregas e Conector Azure — Decisões de Implementação

## Escopo

Este documento complementa `docs/superpowers/specs/2026-08-28-entregas-design.md`, que já define o modelo de domínio (Cadeia de Entregas, Conector Azure, Detector de Inconsistências) e os princípios do marco Entregas. Aqui ficam as decisões de implementação necessárias para transformar essa spec em um plano de tasks: onde os dados moram, como o Claude CLI é invocado, como falhas do MCP são tratadas e como a confirmação humana é capturada na UI.

Não redefine nada do modelo de domínio já descrito na spec principal — apenas resolve as lacunas de implementação.

## Decisões

### Invocação do Conector Azure

O AutoTester não gerencia autenticação nem configuração do MCP Azure. O usuário já tem um MCP Azure configurado globalmente para o Claude CLI (fora do controle do AutoTester). O novo módulo `src/azureConnector.js` invoca `claude` exatamente como `src/claudeRunner.js` já faz — mesmo padrão de `spawn`, timeout, limite de tamanho de stdout/stderr, envelope JSON — mas com um prompt estruturado pedindo metadados de PR/branch/work items em vez de findings, e sem qualquer flag de configuração de MCP explícita: o `claude` CLI do ambiente do usuário já resolve o MCP Azure sozinho, do mesmo jeito que resolve qualquer outro MCP configurado globalmente.

Isso significa: `azureConnector.js` reusa a mesma superfície de risco já mitigada em `claudeRunner.js` (timeout, limite de saída, cancelamento) sem introduzir uma nova via de configuração de credenciais.

### Envelope de resposta

Um novo módulo `src/azureEnvelopeSchema.js` (paralelo a `src/findingsSchema.js`) valida a resposta do Claude com um schema estrito e allowlist de campos:

```
{
  repository: string,
  branch: string,
  pullRequest: { id: string, title: string, status: string, targetBranch: string, url: string } | null,
  reviewers: string[],
  workItems: [{ id: string, title: string, url: string }],
  fetchedAt: string (ISO timestamp)
}
```

Qualquer campo fora dessa allowlist é descartado silenciosamente na validação (não é erro — o Claude pode retornar campos extras que o schema ignora). Campos ausentes ou malformados que violem os tipos acima tornam a resposta inválida — trata-se como falha de consulta (ver Tratamento de Falha), não como erro fatal do processo.

Nenhum conteúdo de arquivo, diff, token ou credencial é aceito neste envelope — o schema rejeita qualquer estrutura que não seja estritamente essa.

### Tratamento de Falha do MCP

Falha de spawn, timeout, saída não-JSON, ou resposta que não valida contra o envelope: `azureConnector.js` rejeita a Promise com um erro tipado (mesmo padrão de `error.code` já usado em `claudeRunner.js`, ex. `AZURE_MCP_TIMEOUT`, `AZURE_MCP_INVALID_ENVELOPE`).

A camada de IPC (`deliveries:sync-azure`) captura esse erro e, em vez de propagá-lo como falha de IPC, grava uma inconsistência na Entrega (evento `kind: 'inconsistency'` no timeline existente, com `detail` descrevendo a evidência) e retorna a Entrega atualizada com sucesso. Isso cumpre a regra da spec: "Falha, indisponibilidade ou resposta inválida do MCP não bloqueiam o uso local."

O vínculo manual de PR (edição direta dos campos da Entrega já existentes) continua disponível independentemente do estado da sincronização Azure — não é um recurso novo, é o comportamento atual do editor de Entrega.

### Armazenamento da Cadeia

Campo `chain` opcional na própria Entrega, não uma store separada:

```
delivery.chain = {
  chainId: string,
  position: number,
  dependsOn: string[],   // deliveryIds
  confirmedAt: string    // ISO timestamp; ausente = nunca confirmada
} | null
```

Migração v2→v3 em `deliveryStore.js`: mesma abordagem conservadora de v1→v2 (`migrateV2Delivery` adiciona `chain: null`, preserva todo o resto). `STORE_VERSION` sobe para 3.

Todas as Entregas de uma cadeia compartilham o mesmo `chainId`; a ordem de aprovação é dada por `position`. `dependsOn` lista os `deliveryId`s que precisam estar `merged` antes desta.

### Fluxo de Confirmação Humana

Dois IPCs novos, guardados por `assertTrustedRenderer` como todos os outros:

- `deliveries:suggest-chain` — recebe uma lista de `deliveryId`s candidatos (ou nenhum, deixando o Claude inferir do Git/Azure), invoca `azureConnector` com um prompt de sugestão de cadeia, retorna a sugestão **sem gravar nada**. Formato de retorno: `{ suggestion: [{ deliveryId, position, dependsOn }], evidence: string }`.
- `deliveries:confirm-chain` — recebe a lista final (igual à sugestão, ou editada pelo usuário) e grava `chain` em cada Entrega afetada, com `confirmedAt` no momento da gravação.

A UI mantém a sugestão em estado transiente do renderer (não em disco) até o usuário clicar aceitar/ajustar-e-confirmar/rejeitar. Rejeitar apenas descarta o estado transiente — nada é gravado. Isso cumpre a regra "uma inferência do Claude... nunca vira estado operacional sem confirmação humana" sem precisar de um estado "pending" persistido.

### Detector de Inconsistências

Módulo puro `src/deliveryInconsistencyDetector.js`, sem I/O — recebe uma Entrega (com seu `chain` e o resultado mais recente de `deliveries:sync-azure`, se houver) e retorna uma lista de inconsistências:

```
{ severity: 'high'|'medium'|'low', evidence: string, recommendedAction: string, detectedAt: string }
```

Verificações desta primeira fase (da spec, seção Detector de Inconsistências): branch da Entrega diferente da branch vinculada à PR Azure; base diferente de `Dev`; PR ausente ou apontando para destino diferente de `Dev`; dependência (`dependsOn`) não `merged` antes de uma Entrega que a requer. As verificações relacionadas a Política/Escopo (regra obrigatória sem evidência, arquivo fora do escopo) ficam para o marco seguinte (Escopo e Exceção), que ainda não existe nesta base de código.

Inconsistências não persistem como estado próprio — são recalculadas sob demanda (chamada de IPC) e anexadas como evento no timeline da Entrega quando descobertas, seguindo o padrão já usado para outros eventos.

## Fora de Escopo (herdado da spec principal)

- API Azure DevOps direta, OAuth, PAT ou armazenamento de credenciais.
- Sincronização automática de contexto local entre máquinas.
- Escrita de código, merge, push ou rebase automático.
- Escopo de Entrega e Exceção de escopo (marco seguinte).
