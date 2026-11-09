# Otimização de custo da Central — 09/11/2026

Alterações da aplicação principal, preparadas a partir de `f6698ee6fd5c56f2eea2cbbad1d1b4c37fd9628d`. Não há migração de banco ou DDL neste conjunto. A economia em produção deve ser medida após a implantação; os testes não estimam redução da fatura.

## Comportamento entregue

- **Atividades e Hub:** a janela que inclui hoje continua atualizando a cada 60 segundos enquanto a aba está visível. Históricos deixam de consultar automaticamente a cada minuto; Atualizar e retorno à aba consultam novamente.
- **Linha do tempo de Atividades:** a API reúne os intervalos completos antes de paginar, preservando a união de contextos iguais separados por até 15 segundos, sobreposições e ordenação. A tela recebe até 50 grupos por página, com cursor vinculado a usuário, agente, data e filtros. Totais e rankings continuam considerando o dia inteiro.
- **Captura de Horas:** LOB e supervisor podem restringir os candidatos por ID, login e vínculo de máquina antes da leitura bruta. O mesmo filtro final usado pela tela confirma o resultado. Estações sem vínculo continuam disponíveis em Sem LOB/Sem supervisor. Arquivos históricos preservam os metadados armazenados, sem aplicar o cadastro atual para excluir linhas antecipadamente.
- **Arquivos e períodos:** consultas simultâneas compartilham apenas a validação de arquivo em curso, sem acrescentar prazo de cache. A validação antes/depois de gravar um arquivo continua independente. Correções de entrada são consultadas uma vez por período, preservando a data de cada turno.
- **Exportações:** o botão da Captura continua reutilizando as linhas carregadas por POST. A exportação GET também aplica LOB/supervisor antes da leitura bruta quando isso é seguro.
- **Monitor de ciclos:** o último ciclo válido de filas e agentes é persistido separadamente em SystemConfig, na mesma transação de importação, backfill ou retenção. Um bloqueio transacional e uma nova leitura evitam sobrescrever uma importação mais recente com outra concluída fora de ordem. Estado ausente ou inválido mantém a consulta anterior como fallback.
- **Retenção de atividades:** a importação não executa mais a exclusão histórica em cada POST. Uma rotina autenticada executa às :27 de cada hora, com lotes limitados e SKIP LOCKED. A configuração existente de retenção permanece: padrão de sete dias, limitada entre um e 90 dias.

## Como usar Aplicar filtros

Na Captura de Horas, selecione LOB e supervisor e pressione **Aplicar filtros** para carregar o recorte completo. A tela informa quando há uma seleção pendente e bloqueia a exportação até aplicá-la. Presença, turno, situação do cronograma e busca continuam refinando as linhas carregadas.

**Atualizar** renova também as opções da equipe, mantendo os filtros visuais. A exportação usa os valores já exibidos, incluindo correções e cálculos de atraso/hora extra. Trocar a data carrega novamente o escopo completo antes de restringi-lo.

## Limites preservados

- Nenhuma regra de duração, madrugada, cronograma, entrada corrigida, permissão ou origem dos registros foi substituída.
- A paginação é uma consulta ao conjunto atual, não um snapshot imutável. Atualizar ou retornar à aba reinicia o cursor; durante a navegação do dia atual, o intervalo de atualização de 60 segundos permanece.
- O agrupamento ocorre no banco antes do limite de página. Reduz a transferência de detalhes para a função/navegador, mas não elimina a leitura necessária aos totais completos.
- A rotina de retenção processa por padrão até quatro lotes de 5.000 registros, com orçamento de 20 segundos, timeout de instrução de cinco segundos e timeout de bloqueio de um segundo. Se restar histórico expirado, os próximos ciclos continuam o trabalho.
- Este conjunto não altera o coletor V2, seus intervalos de envio, a ponte entre ambientes ou a cobrança fixa de compute.

## Provas de validação

- Lote de UI, consultas, paginação, arquivos, horas e exportações: **87 testes aprovados**.
- Lote de monitor, cabeças e manutenção executado pelo responsável pela integração: **28 testes aprovados**. Há cobertura sobreposta; os números não devem ser somados.
- TypeScript, ESLint dos arquivos de produção alterados, verificação de espaços do diff e build de produção aprovados.
- PGlite executou a consulta completa de paginação, incluindo fronteiras de 15/16 segundos, intervalos aninhados, mudança de contexto, empate de ordenação e um grupo com 80 eventos que não pode ser cortado por uma página.
- Uma fixture de Captura leu três eventos em vez de nove e manteve exatamente as mesmas linhas selecionadas, vínculo de login antigo, turno noturno e correção de entrada. Isso é prova de equivalência da fixture, não medição de economia em produção.
- Testes cobrem permissões, arquivo legado preservado, eventos atrasados, correção de cadastro, deduplicação de validações simultâneas e leitura única de correções por período.

## Retenção, falhas e rollback

A exclusão de batches/summaries do Real Time e a atualização do checkpoint agora compartilham a mesma transação de até 30 segundos. Se a publicação das cabeças falhar, a retenção também é revertida; o monitor não mantém um checkpoint que aponta para resumos excluídos. Isso resolve o risco identificado na revisão independente.

Após a implantação, conferir respostas das rotinas, importações, monitor, navegação entre páginas, totais/exportações e frescor das atividades. Comparar consumo por serviço em períodos equivalentes, sem converter contagens de logs ou nonces diretamente em faturamento.

Para rollback da aplicação, reverter o commit deste conjunto e reimplantar a versão anterior. A chave adicional em SystemConfig é compatível com a versão anterior, que a ignora; não é necessário apagá-la. O código anterior volta a executar a retenção por upload. Rollback de código não recupera registros expirados que uma política de retenção já tenha excluído.

