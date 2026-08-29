# Roadmap do AutoTester

## Objetivo do Sistema

O AutoTester nasceu para tornar revisoes e validacoes locais repetiveis, auditaveis e seguras antes de um merge. Em vez de depender de uma unica analise manual ou de comandos soltos no terminal, a aplicacao organiza agentes Claude, testes, cobertura e decisoes humanas em trilhas executaveis.

O principio central e que a automacao produz evidencia, mas nao muda o codigo sozinha. Cada finding pode ser aplicado ou rejeitado individualmente, e a aplicacao preserva o contexto Git que tornou essa decisao valida. O resultado e uma ferramenta local para equipes que querem elevar a qualidade sem enviar o repositorio, seus arquivos ou seus tokens para um servico intermediario.

## Entregas Concluidas

### Fundacao de Review

- Analise de branch e commit selecionados, com escopo por pastas, glob e arquivos.
- Integracao local com Claude CLI por stdin, sem usar `ANTHROPIC_API_KEY`.
- Findings estruturados, aplicacao individual e protecoes contra branch, commit ou arquivo alterado.
- Historico local atomico, somente leitura e auditavel.

### Trilhas de Validacao

- Fases Claude com perfis reutilizaveis e skills de qualidade nativas ou personalizadas.
- Fases command para testes locais, timeout, cancelamento e codigo de saida esperado.
- Subagentes Claude paralelos em lotes de ate duas fases; comandos continuam sequenciais.
- Cobertura LCOV, gates de minimo/queda e baseline de execucoes aprovadas.
- Verificacao de que o LCOV foi criado ou atualizado pela fase atual, impedindo gates aprovados por relatórios antigos.

### Auditoria e Privacidade

- Findings, decisoes, cobertura e gates preservados no Log local.
- Exportacao JSON e Markdown por allowlist, sem tokens efemeros, comandos, sugestoes, conteudo de arquivos, erros ou logs brutos.
- Logs de command phase nao persistem por padrao; exigem opt-in explicito na trilha.
- Filtros por texto, tipo, status e periodo; retencao configuravel entre 10 e 10.000 execucoes.

### Robustez e Seguranca

- Limites para stdout/stderr do Claude e para quantidade/tamanho dos findings.
- Cancelamento Unix por grupo de processo com escalonamento de `SIGTERM` para `SIGKILL`; encerramento de arvore no Windows com `taskkill`.
- Instancia unica por perfil de usuario para evitar concorrencia na persistencia local.
- IPC protegido por origem confiavel, renderer isolado, navegacao externa bloqueada e novas janelas negadas.
- Electron atualizado para 44 e auditoria npm sem vulnerabilidades reportadas na ultima validacao.

### Distribuicao

- Build Windows NSIS em `release/AutoTester Setup <versao>.exe`.
- Configuracao AppImage para Linux via `npm run dist:linux`.
- Descoberta de VS Code no Windows, Linux e macOS (`code` ou `code-insiders`).
- GitHub Actions valida `npm test` em Windows e Linux a cada PR e push em `main`, e produz artefatos nativos em execucao manual ou release publicada.

### Entregas: Fundacao

- Modelo de Entrega local e versionado (`src/deliveryStore.js`), com migracao de schema e escrita atomica.
- IPC protegida para listar, abrir e salvar Entregas.
- `Entregas` como aba inicial: lista, criacao, edicao, detalhe e linha do tempo de eventos.
- Estados de Entrega: `draft`, `active`, `blocked`, `validating`, `ready-for-pr`, `waiting-approval`, `merged`, `cancelled`.

### Entregas: Politicas, Fluxos e Agentes

- Descoberta de regras do repositorio por allowlist (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `CONTRIBUTING.md`, templates de PR) e armazenamento local de Politicas de Projeto.
- Snapshot imutavel de Fluxo (`flowSnapshot`) por Entrega: copia profunda de politicas, trilha, perfis de agente e skills selecionados no momento do snapshot, sem referencia a registros ao vivo.
- Execucao de trilha vinculada a uma Entrega (`deliveryId`): rejeita branch ou repositorio divergente e snapshot internamente inconsistente antes de rodar qualquer fase, garantindo reproducibilidade mesmo apos perfis/skills mudarem.
- Interface de detalhe da Entrega para descobrir regras, selecionar politica/trilha/agentes/skills, salvar snapshot e rodar a trilha vinculada.

### Entregas: Cadeia e Conector Azure

- Conector Azure via Claude CLI e MCP ja autenticado (`src/azureConnector.js`), sem API Azure direta nem armazenamento de credenciais; envelope JSON validado e limitado a metadados de repositorio, branch, PR, status, revisores e work items.
- Sincronizacao de uma Entrega com o Azure DevOps (`deliveries:sync-azure`): consulta roda no diretorio do repositorio da Entrega; falha, indisponibilidade ou resposta invalida do MCP nunca bloqueiam o uso local — viram inconsistencia acionavel registrada na linha do tempo.
- Detector de inconsistencias (`src/deliveryInconsistencyDetector.js`): branch ou base divergente, PR ausente ou apontando para destino diferente de `Dev`, repositorio Azure diferente do repositorio local, dependencia de cadeia nao aprovada.
- Cadeia de Entregas (`delivery.chain`, schema v3): lista ordenada de Entregas dependentes. Sugestao gerada pelo Claude a partir de Git e Azure fica em estado transiente na interface — so vira estado persistido apos confirmacao humana explicita; rejeitar descarta sem qualquer escrita.
- Interface de detalhe da Entrega com sincronizacao Azure, lista de inconsistencias e fluxo de sugestao/confirmacao de cadeia.

## Estado Atual

- Suite Node: 229 testes aprovados na ultima execucao completa.
- Build Windows: validado com `npm run pack` e `npm run dist`.
- AppImage Linux: configurado e produzido por runner Linux no GitHub Actions. O host Windows atual nao tem privilegio de symlink, WSL de usuario ou Docker ativo para validar esse artefato nativamente.
- Distribuicoes ainda usam icone padrao do Electron e nao possuem assinatura de codigo.
- Versionamento semantico, changelog e procedimento de release documentados em `docs/releases.md`.
- Entregas possuem escopo, excecoes auditaveis e permissao de escrita por fase preservada no snapshot. O executor atual nao realiza escrita automatica de codigo.
- Smoke test Electron em janela oculta cobre criacao de Entrega, Excecao de escopo e configuracao de permissao de escrita na Trilha.

## Proximos Marcos

### 1. Release Profissional

- Adicionar icone proprio para Windows e Linux.
- Configurar assinatura de codigo Windows para reduzir avisos do SmartScreen.

### 2. Validacao de Interface

- Cobrir fluxos Electron completos: criar Entrega, executar Fluxo, retomar em outra sessao, registrar Exceção, criar trilha, executar, cancelar, abrir historico e exportar.
- Exercitar a instalacao e primeira execucao dos artefatos Windows e Linux em ambientes limpos.

### 3. Evolucao de Produto

- Avaliar novos runtimes de agentes apenas quando houver adaptadores reais e testaveis.
- Antes de habilitar escrita automatica, integrar o Guardiao de escopo a uma fase que compare as mudancas e exija Excecao antes de concluir.
- Avaliar redacao opcional de logs antes de permitir a persistencia opt-in.
- Definir politica de backup ou exportacao periodica do historico para equipes que precisem de retencao longa.

## Criterio para Novas Entregas

Uma nova capacidade deve manter o modelo local-first, nao introduzir escrita automatica de codigo, ter limites de dados e timeout, e incluir validacao reproduzivel. Mudancas de distribuicao devem ser verificadas no sistema operacional alvo, nao apenas por cross-build.
