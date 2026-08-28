# AutoTester

Aplicação Electron local para validar qualidade de repositórios Git com Claude CLI, trilhas de validação, subagentes paralelos, testes por comando, cobertura LCOV e histórico auditável.

## Capacidades

- Seleção de branch, pastas, arquivos e filtros glob.
- Trilhas com fases Claude ou comandos de teste, perfis de agente e skills editáveis.
- Subagentes Claude paralelos, com limite de duas fases simultâneas.
- Cobertura LCOV com mínimos, tolerância de queda e baseline local.
- Progresso, timeout e cancelamento de trilhas.
- Histórico somente leitura com findings, decisões, cobertura, gates, logs opt-in limitados e exportação JSON/Markdown.
- Log filtrável por texto, tipo, status e período, com retenção local configurável.

Veja `docs/architecture.md` e `docs/validation-tracks.md` para o modelo e limites operacionais.

## Requirements

- Node.js 22.12 ou superior.
- The `claude` CLI must be installed and available on `PATH`, and already authenticated via a Claude Pro/Max subscription login (`claude` interactive login). This app never reads or sets `ANTHROPIC_API_KEY` — headless calls are billed against the subscription, not an API key, by design.
- Git must be on `PATH`.

## Running

```
npm install
npm start
```

## Tests

```
npm test
```

## Windows Build

```powershell
npm run pack  # validates the packaged application in release/win-unpacked
npm run dist  # creates the NSIS installer in release/
```

The installer is unsigned. Windows may show a SmartScreen prompt until a code-signing certificate is configured.

## Notes

Review file content is piped to the `claude` CLI via stdin rather than passed as a command-line argument, to stay under Windows' ~32767-character command-line length limit for large file selections.
