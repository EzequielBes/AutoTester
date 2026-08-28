# Contexto do Domínio

## Termos

### Entrega

Unidade de trabalho rastreável em um repositório. Nasce com uma branch de feature e acompanha sua Pull Request contra a branch `Dev`. Agrupa o objetivo, branch, PRs relacionados, regras aplicáveis, evidências de validação, decisões, impedimentos e próximo passo. Uma entrega pode atravessar várias sessões, mas não muda código automaticamente.

### Cadeia de Entregas

Sequência ordenada de Entregas em que uma depende da aprovação de outra. Todas as Pull Requests da cadeia apontam para `Dev`; a ordem de aprovação torna a dependência explícita e orienta correções e rebases. O Claude sugere a cadeia a partir do Git e do Azure, e uma pessoa confirma antes de ela ser usada.

### Fonte remota

Sistema externo que fornece metadados de uma Entrega sem receber conteúdo do repositório. A primeira fonte remota é o Azure DevOps, para Azure Repos e Pull Requests.

### Conector Azure

Integração da Fonte remota executada pelo Claude CLI por meio de um MCP Azure já autenticado. O AutoTester não armazena credenciais do Azure nem depende de uma API Azure direta.

### Política de projeto

Conjunto de regras que define como uma Entrega deve ser planejada, implementada e validada em um repositório. Combina regras encontradas no próprio repositório com regras locais cadastradas no AutoTester; cada fluxo escolhe quais regras aplicar.

### Agente de fluxo

Perfil reutilizável que executa uma fase de um Fluxo com instruções, skills, ferramentas e permissões definidas pelo usuário. Um agente pode receber permissão para alterar código automaticamente dentro dos limites registrados na Entrega.

### Exceção de escopo

Alteração fora dos arquivos ou pastas selecionados para uma Entrega. Exige uma justificativa registrada antes de ser aplicada, preservando o vínculo entre a modificação, seu motivo e a Entrega.

### Contexto local

Estado persistente de Entregas, regras, cadeias, decisões, impedimentos e evidências guardado somente pelo AutoTester na máquina da pessoa usuária. Não é incluído automaticamente no repositório nem enviado ao Azure.
