# Delegação pontual de justificativas de faltas

## Escopo

A gestora Hellida recebeu autorização individual para justificar faltas já
registradas dos parceiros vinculados diretamente a seu perfil. A associação usa
o identificador imutável do perfil, definido em `attendance-delegation.ts`.
Não há liberação geral para o cargo GESTOR nem alteração da matriz de permissões.

A autorização exige usuário ativo, perfil não excluído, cargo GESTOR e vínculo
atual do parceiro. Data, parceiro, cronograma e ocorrência precisam corresponder.
Antes de gravar, a transação verifica novamente a autorização, o vínculo e a
falta. Não permite criar cronogramas ou editar datas, turnos e horários. As regras
existentes classificam a falta e calculam os impactos; valores enviados pelo
cliente não substituem essas regras nesta delegação.

O fluxo reutiliza o registro e o histórico existentes. Reenvios idênticos não
duplicam o histórico. Não foi necessária migração nem modificação de dados reais
para publicar a liberação.

## Interface

O modal exibe os erros dentro da janela, mantém os campos após falha e permite
rolagem em telas pequenas. A descrição informa explicitamente sua obrigatoriedade.

## Validação

- 53 testes passaram: delegação, controle de acesso e segurança de sessão.
- Cobertura de escopo, revogação, exclusões, datas divergentes, tipo de ocorrência,
  alteração de vínculo antes da gravação, permissões de cronograma e idempotência.
- Verificação de tipos, lint dos arquivos alterados e build de produção passaram.
- Prévia local com dados fictícios: validação de campos e falha de API aparecem no
  modal, sem perda do texto; conferência em desktop claro e celular escuro.
- Nenhuma justificativa real foi enviada durante os testes.
