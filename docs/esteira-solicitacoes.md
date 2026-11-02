# Esteira de solicitações

A rota `/esteiras` usa somente tabela, abre em Todos e solicita 50 registros por página. A criação manual envia `type: "WFM"` e `source: "pipeline"`; o endpoint rejeita outros tipos com essa origem. Os demais fluxos continuam usando o endpoint existente.

## Prazo WFM

- São 48 horas de segunda a sexta, durante todo o dia, no fuso `America/Sao_Paulo`. Sábado e domingo pausam a contagem; feriados contam.
- WFM genérico começa na criação, pois já segue diretamente para WFM. Outros tipos começam na primeira transição para análise WFM após a aprovação/encaminhamento do supervisor; o aceite do parceiro não inicia o prazo.
- Antes desse envio, os badges mostram “Aguardando parceiro” ou “Aguardando supervisor”, sem entrada no WFM, vencimento ou tempo de SLA. A idade desde a criação é informada separadamente no card. A etapa atual de parceiro/supervisor prevalece sobre evidência histórica inconsistente.
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
| `sort` | `created` (padrão, mais recentes), `oldest` (mais antigos), `deadline` |

O clique no card “Pendente mais antigo” abre uma janela ampliada com `status=Pendentes` e `sort=oldest`, preservando a busca e os filtros aplicados. A janela ocupa 94% da altura disponível, com largura de até 1600px, e tem paginação própria de 10 registros, sem alterar a tabela principal. O usuário escolhe então o pedido para abrir o detalhe. “Pendentes” reúne abertos, em análise e aprovados ainda não encerrados.

O filtro de prazo seleciona somente pendências. A ordenação por vencimento prioriza pendências vencidas e coloca registros sem vencimento ao final.

Cada registro inclui `createdAtIso` e `sla`: `receivedAt`, `closedAt`, `dueAt`, `state`, `closed`, `remainingBusinessMinutes` e, antes do envio, `waitingFor` (`PARTNER` ou `SUPERVISOR`). O valor legado `WAITING_WFM` é mantido no contrato e no filtro de prazo para “Prazo não iniciado”. Datas de cálculo são ISO; a apresentação usa São Paulo.

`summary` considera todos os filtros, antes da paginação. `statusSummary` ignora somente o status selecionado e alimenta os contadores dos botões. Os cards de prazo excluem pedidos encerrados; o mais antigo considera abertos, em análise e aprovados ainda não concluídos.

A consulta obtém a evidência de prazo em lote e carrega os dados completos de apresentação apenas dos IDs da página atual. O acesso por perfil, o escopo pessoal e os filtros legados continuam aplicados nas duas leituras. O impacto no requerido permanece no detalhe.

## Recusa administrativa

ADMIN pode recusar nas etapas de aceite do parceiro, supervisor e WFM, com motivo obrigatório, histórico e auditoria. A autorização de recusa é independente da autorização para aprovar a etapa. A recusa fica indisponível e é negada também no serviço se o pedido já foi aprovado, encerrado ou teve cronograma/efeitos aplicados. Não há reversão de cronogramas. A API informa `canReject` para a interface.

## Validação

- `npm run test:requests`: cálculo de prazo, filtros, indicadores globais, histórico completo, transação e rollback, permissões, criação e troca casada.
- `npm run typecheck` e `npm run build`.
- Conferência no navegador com 72 registros fictícios, em 1440×1000 e 390×844: busca, status, prazo, paginação, filtros adicionais, detalhe, criação WFM e fechamento de diálogos pelo teclado.
- O navegador consulta também a API local autenticada em modo de demonstração e verifica a rejeição de tipo não WFM enviado pela esteira. As interações de criação usam respostas fictícias; não criam pedidos reais.

Não foram executadas operações no banco de produção.
