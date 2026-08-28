# Arquitetura

AutoTester e uma aplicacao Electron local dividida em tres camadas:

- `renderer/`: interface HTML, CSS e JavaScript; nao recebe Node integration.
- `preload.js`: API IPC explicita e limitada para o renderer.
- `main.js` e `src/`: Git, filesystem, Claude CLI, execucao de comandos, historico e persistencia.

## Seguranca de contexto

Uma analise le o conteudo do commit da branch selecionada. Antes de aplicar um finding, a aplicacao exige a mesma branch, o mesmo commit, o mesmo hash de arquivo e um token efemero da execucao. Entradas historicas nao carregam esse token e sao somente leitura.

## Persistencia

Trilhas, perfis e skills usam JSON local versionado. O historico tambem usa escrita atomica e recusa arquivos corrompidos para evitar apagar evidencias silenciosamente. A aplicacao aceita apenas uma instancia por perfil de usuario, evitando atualizacoes concorrentes nesses arquivos. A retencao padrao preserva as ultimas 250 execucoes e pode ser ajustada no Log entre 10 e 10.000 entradas; reduzir o limite remove imediatamente as entradas mais antigas.

## Execucao

Fases Claude podem rodar em lotes paralelos de ate dois subagentes sobre o mesmo snapshot. Fases de comando sao sequenciais e podem coletar LCOV. Cada trilha pode ser cancelada; comandos e Claude CLI recebem sinal de abort e timeout. A exportacao de uma entrada usa escrita atomica para nao deixar relatórios parciais no destino.
