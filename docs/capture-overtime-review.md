# Validação do excedente de horas da Captura

As próximas importações da Captura de Horas (ABS e Upload de Horas), incluindo a resolução de divergências, preservam o cálculo completo em `actualHours`. Acima de 8 horas operacionais por pessoa/data do turno, `effectiveHours` fica em 8 até a aprovação. Recusar exige motivo e mantém 8 horas. O cálculo considera os acréscimos atuais, com limite estrito de 8h; não aplica a tolerância de divergência de minutos.

Meu Espaço inclui **Excedente de horas** no filtro Horas. Supervisor responde pelas revisões atribuídas a seu perfil; Admin e WFM podem responder por qualquer time, inclusive **Sem supervisor**. Gestor consulta. As decisões individuais ficam em Respondidas, com histórico e auditoria. Invoice e totais continuam usando `effectiveHours`; o excedente pendente aparece separado como **Horas em validação**, inclusive no consolidado mensal e na exportação.

## Ordem de ativação

1. Aplicar primeiro a migração aditiva `20261005132002_capture_overtime_review` com o fluxo habitual de `npm run db:deploy`, somente após autorização de implantação no banco configurado. A migração cria a tabela/enum/índices, valida motivo de recusa e habilita RLS sem políticas para a Data API. O acesso interno continua pela conexão Prisma do servidor.
2. Publicar a versão do aplicativo com o novo Prisma Client. A versão anterior pode continuar em execução durante a aplicação da migração; a nova versão depende da tabela nova.
3. Conferir uma importação de 8h e uma acima de 8h, a pendência no Meu Espaço, aprovação/recusa e exportação. Não executar backfill: lançamentos existentes permanecem como estão. A regra vale na próxima importação ou reimportação, inclusive de datas antigas.

## Reimportação e substituição

O fingerprint inclui duração capturada, regra e resultado do cálculo, chave da captura e identificação/horários do turno. Dados idênticos mantêm a decisão sem duplicar revisão. Origem alterada acima de 8h gera nova versão pendente; resultado até 8h cancela a revisão. Mudança apenas de supervisor reatribui a revisão e preserva a decisão para a mesma origem.

Planilha, lançamento manual, ajuste manual aprovado e exclusão cancelam a revisão vigente na mesma transação da alteração das horas. A exclusão desvincula o registro de horas, preservando a revisão cancelada e a auditoria. Alterações anteriores ficam no histórico e na auditoria. Uma decisão exige a versão pendente vigente e verifica o registro/turno dentro de transação Serializable; concorrência, revisão cancelada ou versão antiga retorna HTTP 409 para atualização da tela.

## Validação local

Os testes usam fronteiras Prisma em memória, sem alterar dados de produção. Cobrem o limite estrito, acréscimo de 30 minutos, data do turno noturno, permissões, motivo de recusa, reimportação igual/alterada, resolução de divergência, cancelamento, conflito com rollback, apresentação, exportação e cálculo de invoice. A validação Prisma, o typecheck e o build devem passar antes da publicação. Aplicação da migração e testes integrados no banco de destino são etapas de implantação, não executadas pelos testes locais.
