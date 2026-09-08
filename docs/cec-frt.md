# Performance — CEC SLA/FRT

## Fonte e cálculos

Upload dedicado em **Performance > Dados de fila > CEC > Subir SLA/FRT CEC**, apenas ADMIN/WFM. XLSX PO FRT com seis colunas obrigatórias:

- `ticket_base_created_at(年月日)`: data de criação do ticket, preservada como DATE. Não representa hora do atendimento.
- `ticket_agent_email`: usa o prefixo antes do `@`, normaliza caixa/espaços e cruza por WB no cadastro. Aceita domínios históricos, inclusive `@kuashou.com` encontrado no arquivo original; não corrige nem inventa o prefixo do login.
- `merge_group_name_group_priority`: Normal, P0 (também aceita PO, como no arquivo), HM.
- `first_reply_time_over_0_count(求和)`: denominador.
- `first_reply_time_over_240_count(求和)` e `first_reply_time_over_1440_count(求和)`: contadores acima dos prazos.

Normal = `100 * (1 - SUM(over1440) / SUM(total))`. P0 + HM = `100 * (1 - SUM(over240) / SUM(total))`. Nunca juntar Normal e urgentes em um único SLA nem fazer média simples de percentuais. Sem denominador positivo = sem dados.

CPD/output continuam em PerformanceCecCpdRecord pela data de produção original. CPD = tickets / dias-parceiro com produção positiva. Não usar os contadores FRT como produção.

## Importação e segurança

A base completa é validada antes de escrever. Datas inválidas, prioridades desconhecidas, colunas ausentes/ambíguas, contadores negativos/fracionados/inconsistentes ou chaves data+WB+prioridade repetidas impedem a substituição. Retorna até 20 exemplos com número de linha.

Um upload substitui apenas o snapshot CEC_FRT. CPD, produção ADS/TNS, qualidade e seus históricos não são alterados. Registros sem cadastro permanecem nos totais de fila, são sinalizados na cobertura e não entram no time de um supervisor. O vínculo é resolvido na importação; para resolver logins após cadastrar parceiros, reenviar a base. Composição dos supervisores usa o cadastro atual.

Inserção em lotes com status PROCESSING, invisível às consultas. Uma transação com lock publica SUCCESS e remove somente snapshots FRT concluídos anteriores. Falhas removem apenas o lote ainda em PROCESSING, mantendo o anterior. A tabela tem constraints, índices e RLS sem acesso anônimo/autenticado pela Data API; as rotas verificam o usuário no servidor.

## Consulta e exportação

Período de até 366 dias, visões diária/semanal (segunda-feira)/mensal. A base não permite visão horária. Download XLSX traz Resumo, todos os Períodos, Parceiros e Supervisores, incluindo numeradores e denominadores. Datas sem registros não são convertidas em zero. A busca de parceiro filtra somente a tabela; a exportação contém o período completo.

Meu Espaço reutiliza o serviço, filtrando os IDs CEC autorizados antes da agregação. SLA, CPD, produção e cobertura têm denominadores independentes.

## Publicação

Requer a migração Prisma `20260908014500_cec_frt` antes do deploy do código. Não importa automaticamente a planilha do usuário. O teste unitário está em `src/lib/cec-frt.test.ts`, acompanhado de regressão de Meu Espaço.
