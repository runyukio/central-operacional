# UR / Utilização

Upload independente em Performance → Atualizar bases → UR / Utilização. Substitui somente a base UR, integralmente e na mesma transação das demais bases selecionadas. Não altera produção, qualidade, CPD, captura, cronogramas ou faturamento. ADM/WFM usam a autorização de importação existente.

Regra confirmada: **tempo de fato moderado em horas / 8h por parceiro + Brazil Shift Date**, meta mínima de 60%. O campo de horas de escala e o percentual prontos do Excel não participam do cálculo. A exportação enviada em 10/09/2026 contém valores de escala agregados (72, 232 etc.), que não representam o turno de oito horas definido para este indicador.

- Campo preferencial: `实际审核时长线上线下_Actual_moderate_hours`; também aceita o alias solicitado `实际审核时长线上/线下_actual_moderate_duration`, na mesma unidade (horas).
- Parceiro: `employee`, com normalização para minúsculas/prefixo de e-mail; associação ao identificador de EmployeeProfile. Mais de um cadastro por login bloqueia o envio. Sem cadastro: preservado na base e informado no upload, mas não atribuído a um time. Reenviar após corrigir o cadastro.
- Data: `Brazil Shift Date`, inclusiva nos filtros; não converter pelo horário UTC nem pela data do nome do arquivo.
- Lê todas as células mesmo se a dimensão declarada for A1; ignora a linha `汇总`; limita tamanho compactado, descompactado, linhas e células.
- Duplicatas idênticas por parceiro/data/turno contam uma vez. Valores conflitantes bloqueiam a transação. Turnos distintos no mesmo dia somam moderação; o denominador do dia continua sendo oito horas, uma única vez.
- Consolidados por parceiro, supervisor e evolução: `SUM(actualModerateHours) / SUM(shiftHours) × 100`. Não é média simples de médias. Datas sem registro não geram oito horas artificiais. Registros com moderação zero geram UR zero. Sem base gera Sem dados.
- Valores acima de 100% não são limitados: o upload avisa quando o tempo informado excede oito horas. Conferir origem, especialmente totais históricos.
- UR não é métrica por fila: filtros de latência/fila podem selecionar o conjunto de parceiros, mas não recortar sua jornada. Rótulo explica esse limite.

Visível em Performance/Agentes, Performance/Meus dados (somente usuário atual), Meu Espaço/consolidado e parceiros, evolução e metas. Meu Espaço continua aplicando o escopo servidor do supervisor e o cadastro atual, sem desligados. Nenhuma nova permissão de consulta foi concedida.

Persistência aditiva: PerformanceUrRecord, lote UR e auditoria de importação existentes. RLS habilitado; PUBLIC/anon/authenticated sem privilégios na nova tabela. Leituras servidor exigem IDs previamente autorizados. Sem novas automações ou polling.

Verificação: testes de parser com a base real, duplicidades, razões ponderadas, meta sem arredondamento, escopo e intervalos, upload HTTP individual/múltiplo e preservação atômica de todas as combinações de bases.
