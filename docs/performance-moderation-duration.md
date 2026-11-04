# Moderation Duration em Performance → Agentes

A coluna usa `ProductionRecord.moderationSeconds`, importado de `moderation duration (s)`. O vínculo utiliza o WB normalizado, sem espaços e em minúsculas. Nenhum valor importado é regravado para calcular a métrica.

## Shift Date e filtros

As janelas são construídas pelas mesmas funções da Captura de Horas: `buildRealtimeHoursPlannedShifts` e `buildRealtimeHoursSlotAssignmentWindows`. Isso preserva horários históricos do Cronograma, madrugada, limites entre slots e extensões já utilizadas pela captura. A escolha de um único slot usa a mesma distância e a mesma preferência de desempate.

`bzTime` já contém horário civil brasileiro. A consulta o interpreta uma vez em `America/Sao_Paulo` para compará-lo às janelas. O filtro de Shift Date é aplicado depois da associação, com slots adjacentes disponíveis para evitar atribuições incorretas nos limites.

Os indicadores existentes da área Agentes e da exportação mantêm a consulta original de produção, pela data da base. Submit, output por dia, AHT e filtros de LOB/meta de latência não dependem de haver escala nem de os registros estarem dentro de uma janela da Captura. Agentes com produção sem escala, fora da janela ou sem vínculo cadastral permanecem na listagem original.

A coluna adicional Moderation Duration aplica o período selecionado ao Shift Date da escala. Ela usa uma consolidação separada e não substitui a população nem os totais dos demais indicadores. Sem associação válida à escala, exibe `Sem dados`, preservando a produção disponível. A tela informa essa diferença de referência de data junto à descrição da tabela.

LOB e SLA selecionam as filas no backend. A listagem mantém os filtros originais de turno e supervisor do cadastro; na Moderation Duration, esses filtros também restringem os slots associados. A busca aceita nome ou WB normalizado. Uma busca por agente cadastrado sem produção permite exibir `Sem dados`.

## Soma e apresentação

O banco soma todas as filas/horas e retorna somente agregados por ID do agente e Shift Date. A soma usa os segundos sem arredondamento prévio. O backend arredonda apenas a duração final, formata com divisão inteira e não usa relógios ou objetos Date para formatar a duração.

Zero registrado produz `00:00:00`. Ausência de fonte produz `Sem dados`. Sem slot atribuível, os registros não são associados artificialmente a um dia civil. Durações podem ultrapassar 24 horas.

Para períodos com vários turnos, a célula mostra o acumulado e permite abrir os totais de cada Shift Date. O acumulado é arredondado depois de somar os segundos originais; pode diferir em um segundo da soma dos valores diários já arredondados. O XLSX acrescenta a coluna ao final, mantendo as posições e valores anteriores. Um Shift Date com duração apenas na madrugada pode acrescentar uma linha com a duração; os indicadores de produção sem base naquele período exibem `Sem dados`, sem mover ou criar submits.

A consulta lê registros vigentes, sem criar outra tabela de duração. A chave única/upsert do upload permanece intacta; registros logicamente repetidos por WB normalizado, horário e fila são consolidados pela versão mais recente. Lotes em processamento ou falhos não entram. Linhas válidas de lotes concluídos como SUCCESS ou PARTIAL permanecem elegíveis.

A tela refaz a consulta após importação manual, ao recuperar visibilidade e a cada 60 segundos enquanto aberta. Leituras antigas são canceladas quando filtros mudam.

## Validação

`npm run test:moderation-duration` executa o SQL de produção em PostgreSQL isolado, incluindo filas simultâneas, horas diferentes, madrugada, decimais, ausência/zero, reimportação pelo upload real, filtros, duração acima de 24h e associação exclusiva de slots. Também verifica o payload de Agentes e a apresentação em React.
