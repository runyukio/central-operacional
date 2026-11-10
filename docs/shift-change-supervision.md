# Supervisão em trocas de turno

A aprovação final de uma Troca de Turno resolve um único responsável por **LOB do agente + novo turno + data inicial da vigência**. Não usa o supervisor atual como alternativa nem infere responsabilidade por nome, equipe ou turno isolado.

## Configuração

Em **Configurações → Supervisores → Responsabilidade por LOB, turno e vigência**, o Admin mantém os responsáveis. A matriz fica no armazenamento central existente `SystemConfig`, chave `settings.supervisionAssignments`; não requer alteração de schema ou migração.

Cada responsabilidade tem `id`, `lobId`, `shift` (Manhã, Tarde ou Noite), `supervisorId`, `startsOn`, `endsOn` opcional e `active`. As datas são inclusivas. O fim do responsável anterior deve ser anterior ao início do seguinte. O salvamento impede sobreposição de períodos ativos para a mesma LOB e turno e audita a alteração. A aprovação também verifica sobreposições, inclusive se a configuração tiver sido alterada fora dessa tela.

**Pré-requisito de ativação:** cadastrar e conferir a matriz com as vigências reais. A consulta ao banco em 10/11/2026 não encontrou uma estrutura de responsabilidades datadas nem configuração equivalente em `SystemConfig`. Vínculos atuais de pessoas/equipes não comprovam datas históricas: não foi criado preenchimento automático nem foram alterados dados de produção. Sem matriz, a aprovação é bloqueada com LOB, turno, vigência e motivo.

## Aprovação e vigência

- A transação existente engloba supervisor do Mapa de Parceiros (`EmployeeProfile.supervisorId`), horários, snapshots do Cronograma, histórico, auditoria e status final da solicitação. Qualquer falha desfaz a transação.
- Para troca fixa, os registros ativos a partir do Shift Date inicial recebem o novo turno, horários existentes e supervisor, inclusive os futuros. As jornadas noturnas continuam vinculadas à data inicial, sem usar a data civil da saída.
- Para troca fixa futura, a supervisão do Mapa muda na aprovação, conforme solicitado. O turno e horário cadastrais mantêm o agendamento existente. A rotina de vigência reutiliza o supervisor escolhido na aprovação, salvo no payload; mudanças posteriores da matriz não mudam silenciosamente essa decisão.
- A troca temporária mantém o intervalo original, com limite final inclusivo, e não muda a regra existente dos horários cadastrais. O supervisor é atualizado no Mapa na aprovação e nos slots dentro desse intervalo.
- Nenhum `status`, presença, falta, folga, observação ou hora operacional é reescrito pela aplicação da troca. LOB, contrato, cargo e demais campos cadastrais são preservados.
- Mapa, perfil, busca e filtros já consultam o vínculo `EmployeeProfile.supervisorId`; não há uma segunda lista de supervisores para atualizar.
- Snapshots explícitos anteriores permanecem intocados. Para slots antigos com supervisor nulo, a auditoria datada `EmployeeSupervisionSwap` preserva a interpretação anterior usada pelo Cronograma e seus filtros/exportações. Edições e importações passam a usar a mesma interpretação datada.
- A comparação de status e versão da solicitação protege contra decisões concorrentes; o status terminal impede reaplicação. Há bloqueio da linha do agente e bloqueio compartilhado da matriz durante a aprovação; a edição da matriz usa o bloqueio exclusivo correspondente.
- Aprovações futuras legadas sem supervisor salvo consultam a matriz na data original de vigência, registram o histórico e falham sem aplicar parcialmente se a combinação não estiver definida.

## Verificação

`npm run test:shift-supervision` cobre as 12 combinações de ADS/VIDEO/COMMENTS/CEC com Manhã/Tarde/Noite, escolha da responsabilidade histórica, ausência/ambiguidade/inatividade da matriz, manutenção explicitamente autorizada do supervisor antigo, turno noturno, vigência futura, aplicação agendada, slots futuros, recusa/cancelamento/pendência, falhas no Mapa/Cronograma/auditoria, repetição e duplo clique. Os testes usam a fronteira Prisma simulada, com isolamento e reversão do estado da transação, sem escrever na operação real.

Também foram executados os testes do editor de Cronograma, LOB por slot, leitura/exportação histórica e fluxos de folga/troca casada. TypeScript e compilação de produção passaram. A função de bloqueio compartilhado com retorno convertido para texto foi verificada diretamente no PostgreSQL por consulta sem alteração de registros.

A publicação e o cadastro da matriz são etapas pendentes. A validação de ponta a ponta com uma aprovação real deve ocorrer em homologação com a matriz confirmada, sem usar agentes reais para testes de falha.
