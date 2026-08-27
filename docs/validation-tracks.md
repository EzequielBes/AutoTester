# Trilhas de Validacao

Uma trilha e uma sequencia de fases locais.

## Fases Claude

Uma fase Claude combina perfil de agente, skill, intensidade e criterios adicionais. Skills nativas incluem revisao, seguranca, testes, diagnostico, escopo e prontidao de merge. Skills personalizadas usam uma das bases existentes e acrescentam instrucoes.

Marque fases independentes como paralelas para executa-las em lotes de ate dois subagentes. Uma falha termina o lote atual e bloqueia as fases posteriores.

## Fases de comando

Uma fase de comando executa no working tree da branch atualmente selecionada. Configure timeout, codigo de saida esperado e LCOV opcional. Nao inclua segredos no comando.

Um gate de cobertura pode exigir minimo de linhas, limitar queda em pontos percentuais e avaliar todo LCOV ou apenas os arquivos selecionados. O ultimo resultado aprovado compativel e o baseline local.

## Auditoria

O Log preserva findings, decisoes, status, cobertura, gate e caudas limitadas de logs. A reabertura e somente leitura. Relatorios JSON e Markdown removem conteudo de arquivos, sugestoes, comandos, erros e logs brutos, caminhos locais absolutos e tokens de aplicacao. Eles mantem caminhos relativos dos findings para que a evidencia possa ser localizada.

Use os filtros de texto, tipo, status e periodo para localizar execucoes. A retencao e configurada no mesmo painel e remove as entradas mais antigas assim que o limite e salvo.
