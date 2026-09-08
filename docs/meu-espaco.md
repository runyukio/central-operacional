# Meu Espaço

Página `/meu-espaco`, no menu Rotina. Não substitui Cronogramas, Performance ou Horas Operacionais e não requer migração.

## Escopo e autorização

- A identidade e a role são relidas do usuário ativo no banco em todas as APIs.
- SUPERVISOR: perfil vinculado obrigatório; o filtro de supervisor não pode selecionar outra pessoa.
- GESTOR (inclui os aliases coordenador/gerente): consulta todos, sem responder.
- WFM e ADMIN: consulta ampla; respostas continuam sujeitas às permissões e validações originais.
- Outros perfis não recebem menu, página nem acesso direto às APIs.
- Resultados e horas utilizam os parceiros classificados como agentes no cadastro atual e o vínculo atual `EmployeeProfile.supervisorId`. As regras de classificação de agente são as mesmas da Performance.
- O consolidado reúne somente supervisores operacionais com cadastro Ativo/Active, conta ACTIVE e sem exclusão. Supervisão de Qualidade (cargo/skill Quality/QA/Qualidade) e `wb_hailene` não entram. O filtro e todas as APIs usam esse mesmo conjunto; selecionar diretamente um ID excluído é bloqueado. Parceiros desligados, inativos ou excluídos não aparecem em resultados, horas nem pendências do Meu Espaço. Históricos continuam nas telas originais, sem excluir nem redistribuir ocorrências.
- Faltas usam o time atual. Horas pendentes usam exclusivamente `WorkHourAdherenceJustification.supervisorId`; uma transferência de parceiro não muda esse responsável.
- As consultas de horas recebem um conjunto interno de IDs que só restringe o filtro original. Esse conjunto não vem do navegador.

## Fontes e definições

### Gestão e pendências

Uma CTE comum abastece contadores, paginação e verificação de acesso ao item. Faltas partem de cronogramas não excluídos e da última presença vinculada. Motivos válidos usam o normalizador existente, incluindo aliases históricos. `FALTA_INJUSTIFICADA` já classificada não é pendência sem resposta. Erros de escala justificáveis seguem o mesmo fluxo de ocorrências existente.

Horas exigem registro de Horas Operacionais ainda existente, status PENDING/JUSTIFIED e elegibilidade da integração da Captura, inclusive Go Live. Cancelados, slots protegidos de Nesting/Treinamento e cronogramas excluídos não são cobrados.

O padrão é todas as pendências até a data operacional de hoje, sem corte pelo mês dos indicadores. Datas do filtro de pendências se referem à ocorrência. Idade = dias desde a ocorrência; não é indicador de atraso de SLA. Respondidas no período usam `justifiedAt`/`answeredAt` no fuso America/Sao_Paulo, nunca `updatedAt` como substituto.

Paginação: 50 itens, chave crescente `(date, kind, id)` e cursor vinculado ao usuário, supervisor e filtros. Consultas antigas são canceladas/ignoradas, páginas deduplicadas e respostas atualizam o item localmente. Só os contadores são recarregados depois de responder.

Respostas chamam `updateOperationalAttendance` ou `answerWorkHourAdherenceJustification`. Motivos, categorias, descrição, classificação e auditoria são mantidos no fluxo original. O formulário de faltas não solicita link de evidência; evidências históricas já existentes são preservadas. Consulta do histórico traz até 30 entradas de AttendanceHistory/AuditLog; não existe uma segunda tabela ou histórico.

### Resultados

Consultas agregadas por parceiro e dia, com dados de ProductionRecord, PerformanceCecCpdRecord, QualityRecord, TnsQualityRecord, CecQualityRecord e Schedule. O de/para de filas, restrição de AHT, qualidade KAP visível e prioridade KAP sobre base legada TNS são compartilhados com a Performance.

- ADS inclui a família ADS/PROJECT; TNS agrupa VIDEO/COMMENTS; CEC fica separado.
- Produção total e média diária do time continuam disponíveis internamente para compatibilidade, mas não são exibidas no Meu Espaço.
- Média diária individual (apenas ADS/TNS): produção / dias-parceiro com base. Na linha do parceiro, o denominador são seus próprios dias. CEC exibe CPD e os dois SLAs, sem média diária redundante.
- AHT: soma das durações / soma dos submits elegíveis, nunca média simples dos AHTs. Em TNS, apenas filas de 15 minutos; produção total não sofre esse corte.
- Latência: `SUM(ProductionRecord.latencyMinutesSum) / SUM(submitNum)` por parceiro/dia/time/supervisor, armazenada em minutos. ADS e Comments são exibidos em horas decimais (valor / 60), inclusive nas tabelas, gráficos e exportação de filas da Performance; vídeo TNS permanece em minutos. Apenas registros com submits positivos e latência não nula/não negativa; dados ausentes não viram zero. Filas ADS, vídeo TNS com SLA de 15 minutos no de/para e Comments são consolidados separadamente. Os denominadores de cobertura aparecem nos cards.
- CEC SLA/FRT: separado da latência em minutos, pela data de criação do ticket. Normal: `100 * (1 - SUM(over1440) / SUM(total))`. P0 + HM: `100 * (1 - SUM(over240) / SUM(total))`. Total é `first_reply_time_over_0_count`; denominador zero = sem dados. Reutiliza a base CEC FRT publicada na Performance e respeita os IDs autorizados do time antes da agregação. Não altera os denominadores de CPD, produção, qualidade ou ABS.
- CPD CEC: tickets / dias-parceiro com produção positiva, conforme a Performance.
- Qualidade: acertos / amostras. TNS prefere KAP por parceiro/dia e só usa a base legada quando KAP não cobre aquele dia.
- ABS: faltas / dias escalados, usando os classificadores e arredondamento existentes.
- Dados indisponíveis são `null`/“Sem dados”. Uma base de produção explicitamente zero continua sendo zero.
- Cobertura informa quantidade de parceiros cobertos, últimas datas de cada base e última atualização encontrada no recorte. Ela não afirma que o mês de qualidade está fechado.

### Horas

Consulta mensal de `WorkHourRecord` e `Schedule`, usando as mesmas regras de duração, diferença e captura de Horas Operacionais, sem ações de importação, exclusão ou aprovação. A aba tem seu próprio seletor de mês e busca por nome/WB. Exibe uma linha por parceiro, com soma das horas do mês e projeção da escala futura, nunca uma linha por dia. Paginação de 50 parceiros; captura é consultada em lote para os registros da página. Não existe uma consulta por parceiro/dia.

Cards agregam **todas as páginas** do mês autorizado: realizado soma `WorkHourRecord.effectiveHours` até hoje (inclui ajustes já aplicados); escala futura usa os cronogramas não excluídos de amanhã até o fim do mês e `plannedProductiveHoursForSchedule`, regra atual de 8h produtivas por dia elegível. Folgas, faltas, férias, Nesting e Treinamento não são slots produtivos nessa regra. Total projetado = realizado + escala futura, sem duplicar o dia atual e sem substituir um fechamento aprovado. Dias passados escalados sem registro geram aviso, nunca preenchimento estimado. Hoje pode estar parcial. O mês selecionado sempre abre do primeiro ao último dia, inclusive meses históricos; não modifica o período dos resultados. Os status mensais resumem pendências/divergências, sem atribuir uma aprovação nova.

O visual usa as superfícies e textos dos temas globais, azul padrão para seleção/ação e filtros em slices. A prévia isolada usa dados fictícios e não faz gravações no banco.

## APIs

- GET `/api/meu-espaco/resumo`
- GET `/api/meu-espaco/pendencias`
- GET `/api/meu-espaco/resultados`
- GET `/api/meu-espaco/horas`
- GET/POST `/api/meu-espaco/pendencias/{absence|hours}/{id}`

Respostas HTTP usam `private, no-store`. Abas carregam sob demanda, sem polling. Resultados aceitam até 366 dias por consulta; horas recebem `month=YYYY-MM` e consolidam um mês completo; pendências podem incluir todo o histórico.

## Verificação realizada

- Testes unitários e de serviço para perfis, escopo alterado, supervisor ausente, cursores, datas, fórmulas, transferências, exclusões e gravação única nos históricos originais.
- Testes de concorrência da lista: resposta antiga, carregamento concorrente, deduplicação, resposta durante paginação e recuperação de erro de rede.
- Consultas SQL geradas pelos serviços executadas em modo somente leitura com um conjunto atual de parceiros, período 01–06/09/2026; totais diários reconciliados com os acumulados. Nenhuma justificativa real foi enviada.
- EXPLAIN ANALYZE amostral: produção ~14 ms; resumo ~30 ms; primeira página ~21 ms. Tempos de banco, excluindo rede, autenticação e demais consultas; não constituem garantia de latência.
- Verificação visual dos componentes reais em ambiente isolado com dados fictícios: claro/escuro, largura de 390 px, abas, consulta de horas, paginação, resposta sem recarregar a lista, falha de rede e modo consulta de gestor.
- Testes completos, TypeScript e build de produção exigidos antes do commit.

Não foram alterados dados históricos, automações, webhooks, premiações ou permissões das telas antigas. Publicação em produção é uma etapa separada.
