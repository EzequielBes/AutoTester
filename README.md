# AutoTester

Aplicação Electron local para transformar feature work em **Entregas** rastreáveis: organiza contexto, políticas, fluxos de validação e sincronização com Azure DevOps em torno do Claude CLI já autenticado na máquina — sem enviar código, tokens ou credenciais para um serviço intermediário.

![Node](https://img.shields.io/badge/node-%E2%89%A522.12-339933?logo=node.js&logoColor=white)
![Electron](https://img.shields.io/badge/electron-44-47848F?logo=electron&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)

## Índice

- [Por que existe](#por-que-existe)
- [Capacidades](#capacidades)
- [Requisitos](#requisitos)
- [Uso](#uso)
- [Testes](#testes)
- [Build](#build)
- [Releases](#releases)
- [Arquitetura](#arquitetura)
- [Documentação](#documentação)
- [Notas técnicas](#notas-técnicas)

## Por que existe

Revisão e validação de código costumam depender de uma análise manual pontual ou de comandos soltos no terminal, sem memória entre sessões. O AutoTester assume o oposto: cada unidade de trabalho vira uma **Entrega** local e persistente, que preserva objetivo, branch, decisões, impedimentos, políticas aplicadas e evidências de validação — mesmo atravessando várias sessões do Claude.

O princípio central: **automação produz evidência, mas não muda código sozinha**. Um finding pode ser aplicado ou rejeitado individualmente; uma sugestão de Cadeia de Entregas gerada pelo Claude nunca vira estado persistido sem confirmação humana explícita. Nada disso sai da máquina — sem `ANTHROPIC_API_KEY`, sem API Azure direta, sem repositório ou credenciais enviados a um intermediário.

## Capacidades

### Entregas

- Registro local, versionado e atômico de Entregas: objetivo, branch, base, PR, estado (`draft` → `active` → `validating` → `ready-for-pr` → `waiting-approval` → `merged`/`cancelled`/`blocked`), impedimentos, próxima ação e linha do tempo de eventos.
- Descoberta de regras de política em documentos do repositório (`AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `CONTRIBUTING.md`, templates de PR) e composição de Políticas de Projeto locais.
- Snapshot imutável de Fluxo por Entrega: cópia profunda de políticas, trilha, perfis de agente e skills selecionados no momento do snapshot — reprodutível mesmo que os originais mudem depois.
- Execução de trilha vinculada a uma Entrega, com rejeição automática de branch/repositório divergente ou snapshot internamente inconsistente antes de rodar qualquer fase.

### Azure DevOps e Cadeia de Entregas

- Sincronização com Azure DevOps através do MCP já configurado no Claude CLI — sem API direta, OAuth, PAT ou armazenamento de credenciais no AutoTester.
- Falha, indisponibilidade ou resposta inválida do MCP nunca bloqueiam o uso local: viram uma inconsistência acionável registrada na linha do tempo da Entrega.
- Detector de inconsistências: branch ou base divergente, PR ausente ou fora do alvo esperado, repositório Azure diferente do repositório local, dependência de cadeia ainda não aprovada.
- Sugestão de Cadeia de Entregas gerada pelo Claude a partir de Git e Azure fica em estado transiente na interface — só afeta uma Entrega após confirmação humana explícita; rejeitar descarta sem qualquer escrita.

### Trilhas de Validação

- Fases Claude com perfis de agente reutilizáveis e skills de qualidade nativas ou personalizadas.
- Fases de comando para testes locais, com timeout, cancelamento e código de saída esperado.
- Subagentes Claude paralelos em lotes de até duas fases; comandos permanecem sequenciais.
- Cobertura LCOV com gates de mínimo e tolerância de queda, verificando que o relatório foi gerado pela execução atual — não por um relatório antigo.

### Auditoria e Privacidade

- Histórico local somente leitura: findings, decisões, cobertura, gates e logs opt-in preservados atomicamente.
- Exportação JSON e Markdown por allowlist — nunca inclui tokens efêmeros, comandos, conteúdo bruto de arquivo ou logs não sanitizados.
- Filtros por texto, tipo, status e período; retenção local configurável entre 10 e 10.000 execuções.

### Robustez e Segurança

- IPC restrita a origem confiável, renderer isolado sem Node integration, navegação externa bloqueada, novas janelas negadas.
- Cancelamento por grupo de processo no Unix (`SIGTERM` → `SIGKILL`), encerramento de árvore via `taskkill` no Windows.
- Instância única por perfil de usuário, evitando concorrência na persistência local.

## Requisitos

- **Node.js 22.12** ou superior.
- **Claude CLI** instalado, disponível no `PATH` e autenticado via login de assinatura Claude Pro/Max. O AutoTester nunca lê nem define `ANTHROPIC_API_KEY` — chamadas headless são cobradas contra a assinatura, por design.
- **Git** no `PATH`.
- Para sincronização com Azure DevOps: um MCP Azure configurado e autenticado no próprio Claude CLI.

## Uso

```bash
npm install
npm start
```

A tela inicial é **Entregas**. Crie uma, vincule a uma branch e base, descubra regras do repositório, monte um Fluxo com trilha/agentes/skills e execute — ou sincronize com Azure DevOps e revise a Cadeia sugerida antes de confirmar.

## Testes

```bash
npm test
```

Suite Node built-in test runner, sem dependências externas de teste. Inclui um smoke test Electron em janela oculta para os fluxos essenciais da interface.

## Build

### Windows

```powershell
npm run pack   # valida o app empacotado em release/win-unpacked
npm run dist   # gera o instalador NSIS em release/
```

O instalador não é assinado — o Windows pode exibir aviso do SmartScreen até que um certificado de assinatura de código seja configurado.

### Linux

```bash
npm run dist:linux   # gera um AppImage em release/
```

O AppImage exige um runtime compatível com FUSE em muitas distribuições. Gere-o em Linux ou CI — builds cruzados a partir do Windows exigem Modo de Desenvolvedor ou privilégio elevado de symlink.

## Releases

O projeto usa versionamento semântico. O procedimento de publicação, changelog e limitações atuais de assinatura e ícones estão em [`docs/releases.md`](docs/releases.md).

## Arquitetura

Três camadas: `renderer/` (interface, sem Node integration), `preload.js` (API IPC explícita e limitada) e `main.js`/`src/` (Git, filesystem, Claude CLI, execução, persistência). Detalhes completos, modelo de segurança de contexto e política de persistência em [`docs/architecture.md`](docs/architecture.md).

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/roadmap.md`](docs/roadmap.md) | Objetivo do sistema, entregas concluídas, estado atual, próximos marcos. |
| [`docs/architecture.md`](docs/architecture.md) | Camadas, segurança de contexto, persistência, execução. |
| [`docs/validation-tracks.md`](docs/validation-tracks.md) | Modelo de Trilhas de Validação e seus limites operacionais. |
| [`docs/releases.md`](docs/releases.md) | Versionamento, changelog e publicação de releases. |
| [`CONTEXT.md`](CONTEXT.md) | Vocabulário de domínio: Entrega, Cadeia, Política, Agente de fluxo, Escopo. |

## Notas técnicas

O conteúdo de arquivo em uma revisão é enviado ao `claude` CLI via stdin, não como argumento de linha de comando — evita o limite de ~32767 caracteres de linha de comando do Windows em seleções grandes de arquivo.
