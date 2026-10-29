# Calendário de waves

A Central Operacional exibe o planejamento de novas turmas logo abaixo dos painéis de agentes com mais faltas e attrition. O calendário tem mês próprio, independente do período histórico de faltas, e respeita a LOB selecionada na Central. Quando todas as LOBs estão selecionadas, oferece seu próprio filtro de LOB.

Cada wave contém nome, LOB, quantidade prevista de pessoas, início do treinamento, início do nesting, conclusão do nesting e observações opcionais. A entrada em operação (Go-live) coincide com o início do nesting, inclusive no indicador mensal, na data da turma e na bandeira centralizada na linha. As etapas terminam na véspera da etapa seguinte; o calendário inclui fins de semana. A identificação da LOB usa uma cor própria, enquanto as etapas têm cores consistentes: treinamento roxo, nesting âmbar e entrada em operação verde. Turmas que atravessam meses são recortadas no intervalo exibido.

Os números são previstos e não alteram o cadastro de agentes, as escalas ou o HC realizado. As turmas são cadastradas manualmente, inclusive antes da existência de agentes no sistema.

## Acesso e persistência

`/api/wave-plans` exige sessão e usuário ativo no banco. A visualização requer a capacidade `CENTRAL`; a gestão segue `STAFF_COVERAGE_MANAGE` (Admin, WFM e Gestor). As permissões vêm do usuário atual no banco. Inclusões e alterações validam datas reais, ordem das etapas, LOB existente e quantidade inteira positiva. Atualizações e exclusões usam `updatedAt` para impedir alterações sobre uma versão desatualizada.

O campo legado `goLiveDate` armazena a data de conclusão do nesting (limite exclusivo da barra), preservando os registros existentes. A data de operação é derivada de `nestingStartDate`; não existe uma segunda data de operação no formulário.

Os registros compartilhados ficam na tabela `WavePlan`. A migração `202610291200_wave_plans` deve ser aplicada junto da publicação, antes de disponibilizar o código. Ela adiciona apenas a nova tabela, seus índices, a relação com LOB e restrições para datas e quantidade. Não foi aplicada a nenhum banco durante a implementação local.

## Validação local

- Prisma Client gerado; TypeScript, ESLint e build de produção aprovados.
- `src/lib/wave-planning.test.ts`: datas e sequência das etapas, quantidade, recorte entre meses, anos bissextos e permissões.
- Prévia interativa com o componente real e dados fictícios: cadastro, edição de datas, navegação entre meses, filtro de LOB e exclusão conferidos no navegador.
- Persistência real e migração pendentes de teste em ambiente com conexão de banco configurada. A prévia usa somente dados fictícios armazenados no navegador e não valida a integração com PostgreSQL.
