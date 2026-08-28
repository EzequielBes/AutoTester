# Entregas e Continuidade de Engenharia

## Objetivo

Transformar o AutoTester de uma ferramenta centrada em execuções isoladas em uma ferramenta local-first centrada em Entregas. Uma Entrega preserva o contexto necessário para planejar, implementar, validar, corrigir e aprovar uma feature entre sessões do Claude, sem reenviar o repositório ou depender de uma API Azure direta.

## Escopo do Marco

Este marco acrescenta uma central de Entregas ao aplicativo existente. Ela reutiliza as Trilhas, os perfis de agente, as skills, o executor de comandos, os gates de cobertura e o histórico de evidências já existentes.

Inclui:

- Registro local e atômico de Entregas por projeto.
- Vínculo entre Entrega, branch de feature, base `Dev` e PR Azure.
- Consulta ao Azure DevOps pelo Claude CLI usando o MCP Azure já autenticado.
- Sugestão de Cadeia de Entregas com confirmação humana antes de persistir.
- Políticas de projeto compostas por regras encontradas no repositório e regras locais.
- Fluxos configuráveis com agentes, skills, comandos, gates e permissões de escrita.
- Registro de decisões, impedimentos, inconsistências, próxima ação e exceções de escopo.
- Interface principal de Entregas e detalhes de uma Entrega.

Não inclui:

- API Azure DevOps direta, OAuth, PAT ou armazenamento de credenciais.
- Sincronização automática do contexto local entre máquinas.
- Escrita de código sem uma permissão explícita no Fluxo e no snapshot da Entrega.
- Alteração automática de uma PR, merge, push ou rebase.

## Princípios

- O código-fonte permanece local; o AutoTester não o envia a um intermediário.
- O MCP Azure é acessado somente pelo Claude CLI já autenticado pelo usuário.
- Automação deve deixar evidência reproduzível e não ocultar decisões humanas.
- Toda escrita automática respeita o escopo selecionado ou cria uma Exceção de escopo justificada.
- Uma inferência do Claude, incluindo uma Cadeia de Entregas, nunca vira estado operacional sem confirmação humana.

## Modelo de Domínio

### Entrega

Uma Entrega é criada para uma branch de feature. Ela guarda objetivo, branch, base `Dev`, PR relacionada, Política de Projeto, Fluxo, escopo, cadeia, estado operacional e evidências. A Entrega é local e pode ser reaberta em outra sessão.

Estados: `draft`, `active`, `blocked`, `validating`, `ready-for-pr`, `waiting-approval`, `merged`, `cancelled`.

### Cadeia de Entregas

Uma cadeia é uma lista ordenada de Entregas dependentes. Todas as PRs apontam para `Dev`. Uma Entrega dependente pode abrir sua PR antes das anteriores entrarem em `Dev`, mas a central mostra a ordem de aprovação e alerta quando uma correção ou rebase precisa ser propagado.

O Claude consulta Git e Azure pelo MCP, sugere a cadeia e explica a evidência. A pessoa confirma, ajusta ou rejeita a sugestão antes de ela ser salva.

### Política de Projeto

Uma Política é formada por:

- Regras descobertas no repositório, identificadas com caminho e trecho de origem.
- Regras locais escritas pelo usuário, guardadas no armazenamento local do AutoTester.
- Seleção de regras obrigatórias e opcionais por Fluxo.

Regras podem exigir convenções de branch e PR, comandos, cobertura, documentos, formatos, revisões ou decisões registradas. A execução preserva um snapshot das regras aplicadas.

### Fluxo e Agente

Um Fluxo é o processo escolhido para uma Entrega, como `Nova feature`, `Correção de PR` ou `Pré-merge`. Ele contém fases ordenadas. Cada fase usa um Agente de fluxo ou um comando local.

Um Agente de fluxo é configurado com instruções, skills, ferramentas, intensidade e permissão de escrita. A permissão é uma propriedade explícita da fase e é copiada para o snapshot da execução. Novos agentes e skills podem ser cadastrados localmente.

### Escopo e Exceção

O escopo de uma Entrega é uma seleção de arquivos, pastas e filtros glob. Antes de uma fase com escrita automática aplicar uma mudança, o Guardião de escopo compara os arquivos modificados ao escopo.

Uma mudança fora do escopo exige uma Exceção de escopo com arquivos afetados, justificativa, agente/fase responsável e data. Sem essa informação, a fase não conclui como aprovada.

### Evidência Operacional

Cada Entrega mantém uma linha do tempo somente leitura de eventos: criação, vinculação de branch e PR, confirmação de cadeia, execução de fases, resultados de comandos, cobertura, findings, decisões, impedimentos, exceções, inconsistências e próximo passo.

## Arquitetura

### Registro de Entregas

Um novo armazenamento JSON local e versionado persiste Entregas, Políticas, Fluxos locais, snapshots e eventos. Ele segue o padrão de escrita atômica e rejeição de arquivos corrompidos usado pelo histórico atual. O armazenamento não entra no repositório nem é exportado por padrão.

### Conector Azure via Claude

O processo principal chama o Claude CLI com um prompt estruturado para consultar o MCP Azure configurado pelo usuário. A resposta deve obedecer um envelope JSON limitado que contém somente metadados de repositório, branch, PR, status, revisores, work items e links. Conteúdo de arquivos e credenciais não são persistidos.

Falha, indisponibilidade ou resposta inválida do MCP não bloqueiam o uso local: a Entrega mostra uma inconsistência acionável e aceita vínculo manual de PR e cadeia.

### Orquestração

O executor de Trilhas recebe um contexto opcional de Entrega. Para cada fase, ele disponibiliza apenas objetivo, regras selecionadas, cadeia confirmada, decisões abertas, impedimentos, escopo e permissões. Ao fim da fase, ele registra a evidência e atualiza a próxima ação sugerida.

Fases que falham, expiram ou são canceladas preservam seu estado. Fases dependentes não iniciam até a resolução explícita da falha. A aplicação não realiza push, merge, abertura de PR ou rebase automaticamente.

### Detector de Inconsistências

O detector verifica, antes e depois de um Fluxo:

- Branch da Entrega diferente da branch selecionada.
- Base diferente de `Dev`.
- PR ausente, apontando para destino diferente de `Dev` ou incompatível com a cadeia confirmada.
- Dependência não aprovada antes de uma Entrega que exige seu rebase.
- Regras obrigatórias sem evidência de validação.
- Finding, impedimento ou decisão pendente.
- Arquivo alterado fora do escopo sem Exceção registrada.

Cada inconsistência declara gravidade, evidência, ação recomendada e o evento que a originou.

## Experiência

### Navegação

`Entregas` será a tela inicial. `Execução`, `Políticas` e `Histórico` complementam a navegação. A revisão atual continua disponível dentro de uma Entrega e como execução isolada para compatibilidade.

### Lista de Entregas

A lista ordena primeiro Entregas bloqueadas, com inconsistências ou próximas da aprovação. Cada cartão mostra objetivo, branch, PR, posição na cadeia, última evidência, impedimento e próxima ação.

### Detalhe de Entrega

O detalhe possui cabeçalho com estado e cadeia, seguido por abas para:

- Contexto: objetivo, branch, PR, regras, links e decisões.
- Fluxo: fases, agentes, skills, escopo e permissões.
- Execução: progresso, resultados, cobertura, findings e ações permitidas.
- Linha do tempo: eventos e evidências entre sessões.
- Inconsistências: problema, impacto, evidência e ação recomendada.

### Direção Visual

O visual combina workspace editorial e console de evidências: fundo slate escuro, superfícies discretas, verde para estado positivo, âmbar para atenção e vermelho apenas para bloqueio. Conteúdo usa uma família legível como `Inter` ou `Manrope`; paths, branches, hashes, comandos e diffs usam fonte monoespaçada. A navegação lateral dá contexto sem competir com a tarefa principal.

Interfaces devem ter foco visível, contraste suficiente, leitura responsiva e suporte a `prefers-reduced-motion`.

## Validações

Todo Fluxo pode aplicar gates nas seguintes etapas:

1. Pré-condições: branch, base, PR, cadeia, regras e escopo válidos.
2. Planejamento: agente registra intenção de alteração e arquivos esperados.
3. Implementação: escrita permitida apenas pela fase e pelo escopo.
4. Validação: comandos, testes, lint, cobertura LCOV e skills configuradas.
5. Prontidão de PR: convenções da Política, evidências mínimas, cadeia, exceções e pendências.
6. Persistência: resultado, decisões, impedimentos e próxima ação registrados na Entrega.

## Testes

- Unitários para validação e migração do Registro de Entregas.
- Unitários para criação e confirmação de Cadeias, Políticas e Exceções de escopo.
- Unitários para o Detector de Inconsistências e o envelope do Conector Azure.
- Integração para passar contexto da Entrega ao executor de Trilhas e registrar resultados.
- Widget/renderer tests para estados de lista, detalhe, bloqueio e exceção.
- Testes Electron ponta a ponta para criar Entrega, executar Fluxo, retomar outra sessão, registrar exceção e identificar cadeia inconsistente.

## Segurança e Privacidade

- Nenhuma credencial Azure é lida, escrita ou exibida pelo AutoTester.
- Respostas do Claude e do MCP têm limites de tamanho, schema e campos permitidos.
- Contexto local não inclui conteúdo integral do repositório, tokens ou logs brutos por padrão.
- Uma fase com escrita automática exige permissão registrada e respeita o Guardião de escopo.
- A abertura de editor, exportação, IPC e navegação mantêm as proteções existentes.
