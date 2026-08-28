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

## Estado Atual

- Suite Node: 117 testes aprovados na ultima execucao completa.
- Build Windows: validado com `npm run pack` e `npm run dist`.
- AppImage Linux: configurado, mas deve ser gerado em Linux ou CI. O host Windows atual nao tem privilegio de symlink, WSL de usuario ou Docker ativo para validar esse artefato nativamente.
- Distribuicoes ainda usam icone padrao do Electron e nao possuem assinatura de codigo.

## Proximos Marcos

### 1. CI Multiplataforma

- Criar workflow GitHub Actions para rodar `npm test` em Windows e Linux.
- Produzir o instalador NSIS e o AppImage em runners nativos.
- Publicar artefatos anexados a cada release ou execucao manual.

### 2. Release Profissional

- Adicionar icone proprio para Windows e Linux.
- Definir versionamento semantico, changelog e notas de release.
- Configurar assinatura de codigo Windows para reduzir avisos do SmartScreen.

### 3. Validacao de Interface

- Cobrir fluxos Electron completos: criar trilha, executar, cancelar, abrir historico e exportar.
- Exercitar a instalacao e primeira execucao dos artefatos Windows e Linux em ambientes limpos.

### 4. Evolucao de Produto

- Avaliar novos runtimes de agentes apenas quando houver adaptadores reais e testaveis.
- Avaliar redacao opcional de logs antes de permitir a persistencia opt-in.
- Definir politica de backup ou exportacao periodica do historico para equipes que precisem de retencao longa.

## Criterio para Novas Entregas

Uma nova capacidade deve manter o modelo local-first, nao introduzir escrita automatica de codigo, ter limites de dados e timeout, e incluir validacao reproduzivel. Mudancas de distribuicao devem ser verificadas no sistema operacional alvo, nao apenas por cross-build.
