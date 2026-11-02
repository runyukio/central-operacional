# Esteira de solicitações

A rota `/esteiras` usa somente tabela, abre em Todos e solicita 50 registros por página. A criação manual envia `type: "WFM"` e `source: "pipeline"`; o endpoint rejeita outros tipos com essa origem. Os demais fluxos continuam usando o endpoint existente.

## Prazo WFM

- São 48 horas de segunda a sexta, durante todo o dia, no fuso `America/Sao_Paulo`. Sábado e domingo pausam a contagem; feriados contam.
- WFM genérico começa na criação. Outros tipos começam na primeira transição para análise WFM; o aceite do parceiro não inicia o prazo.
- Aprovação mantém o prazo ativo. Conclusão, recusa e cancelamento congelam o resultado no encerramento.
- O limite exato de 48h ainda está dentro do prazo; o atraso começa depois dele.
- A evidência vem do histórico completo, sem limite de 30 eventos. Na troca casada, `supervisorApprovedAt` também é evidência válida de entrada.
- Quando falta evidência de entrada ou encerramento, a interface informa “Prazo sem registro”. Não usa `updatedAt` como substituto.
- Encaminhamentos do supervisor gravam status e histórico na mesma transação. A falha do histórico desfaz a mudança de status.

O cálculo está centralizado em `src/lib/request-pipeline.ts`. Não há migração, backfill ou alteração retroativa dos pedidos.

## Contrato de consulta

`GET /api/requests` preserva os parâmetros anteriores e acrescenta:

| Parâmetro | Valores |
| --- | --- |
| `deadline` | `WAITING_WFM`, `WITHIN_DEADLINE`, `OVERDUE`; omitido equivale a Todos |
| `sort` | `created` (padrão, mais recentes), `deadline` |

O filtro de prazo seleciona somente pendências. A ordenação por vencimento prioriza pendências vencidas e coloca registros sem vencimento ao final.

Cada registro inclui `createdAtIso` e `sla`: `receivedAt`, `closedAt`, `dueAt`, `state`, `closed` e `remainingBusinessMinutes`. Datas de cálculo são ISO; a apresentação usa São Paulo.

`summary` considera todos os filtros, antes da paginação. `statusSummary` ignora somente o status selecionado e alimenta os contadores dos botões. Os cards de prazo excluem pedidos encerrados; o mais antigo considera abertos, em análise e aprovados ainda não concluídos.

A consulta obtém a evidência de prazo em lote e carrega os dados completos de apresentação apenas dos IDs da página atual. O acesso por perfil, o escopo pessoal e os filtros legados continuam aplicados nas duas leituras. O impacto no requerido permanece no detalhe.

## Validação

- `npm run test:requests`: cálculo de prazo, filtros, indicadores globais, histórico completo, transação e rollback, permissões, criação e troca casada.
- `npm run typecheck` e `npm run build`.
- Conferência no navegador com 72 registros fictícios, em 1440×1000 e 390×844: busca, status, prazo, paginação, filtros adicionais, detalhe, criação WFM e fechamento de diálogos pelo teclado.
- O navegador consulta também a API local autenticada em modo de demonstração e verifica a rejeição de tipo não WFM enviado pela esteira. As interações de criação usam respostas fictícias; não criam pedidos reais.

Não foram executadas operações no banco de produção.
