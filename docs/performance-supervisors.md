# Performance — Supervisores

A tabela mantém ABS, attrition, humor, AHT/CPD e qualidade e inclui aderência à jornada de 8h, taxa de atraso, taxa de saída antecipada e hora extra oficial. Clicar no nome abre os agentes do supervisor, no mesmo período. O detalhe pode ser filtrado por nome/WB e ordenado por indicador.

## Fontes e fórmulas

- Equipe: agentes pelo vínculo atual de `EmployeeProfile.supervisorId`, sem perfis excluídos, conforme o consolidado existente de Performance. O novo detalhe usa exatamente esses IDs e a permissão de Performance relida no usuário ativo.
- ABS, AHT/CPD e qualidade: cálculos compartilhados com o resultado do time do Meu Espaço. AHT usa ponderação por submits; TNS utiliza filas de 15 minutos. CPD CEC usa tickets por dia-agente com produção positiva. Qualidade TNS prefere KAP no mesmo parceiro/dia. Sem base no detalhe é `null`.
- Humor: média das respostas válidas do período em `EmployeeMoodRecord`, escala 1–5, com quantidade de respostas; ausência de resposta não vira zero.
- Jornada: somente dias produtivos cujo turno terminou, incluindo madrugadas na data de início. Folga, férias, faltas, Nesting e Treinamento não entram nos indicadores de horas/pontualidade; ABS permanece separado.
- Aderência: `100 × soma(min(effectiveHours, 8)) / (8 × dias com registro oficial)`. Cada dia é limitado a 8h antes da soma, impedindo que extra de um dia compense déficit de outro. Registro explícito de zero é zero; dia sem registro é ausência de base. A tabela informa dias com horas / dias elegíveis encerrados.
- Hora extra: soma de `max(effectiveHours − plannedHours, 0)`, com 8h previstas quando o campo está ausente e há escala produtiva elegível. `effectiveHours` já incorpora ajustes e aprovações. Excedentes pendentes não são adicionados novamente.
- Pontualidade: timeline oficial da Captura, com associação de dispositivo/parceiro/escala, união de atividade e validação de arquivos já feitas pelo serviço existente. Taxa de atraso = entradas após o início previsto / entradas observadas. Taxa de saída antecipada = saídas antes do fim previsto / saídas observadas. Conta qualquer diferença positiva truncada em segundos, sem subtrair tolerância. Somente turnos encerrados. Sem entrada/saída, a taxa fica indisponível e não vira pontualidade perfeita.
- Consolidados: somam numeradores e denominadores dos agentes; não fazem média simples de percentuais.

A leitura é em lote por período, com IDs autorizados passados à Captura e sem consultas por agente/dia. Se a Captura falhar, as horas oficiais continuam disponíveis e as taxas ficam ausentes com aviso. Ressalvas dos arquivos de Captura são exibidas. O período máximo é de 366 dias. A API responde `private, no-store`.

O detalhe carrega apenas ao expandir. A troca de período/supervisor descarta a resposta anterior e cancela a consulta; erros permitem tentar novamente. As tabelas rolam horizontalmente, mantendo os nomes visíveis.
