# Report CEC pelo Data Export do Freshdesk

O backend baixa o CSV/XLSX mais recente de um Data Export agendado do Freshdesk, importa todas as linhas válidas e grava um snapshot por ciclo. O painel não acumula os tickets de ciclos anteriores: cada ciclo representa o backlog existente no arquivo naquele momento.

## Por que o painel pode divergir do widget TOTAL Tickets

Os filtros do Data Export e do widget precisam ser idênticos. Se o Data Export tiver `Backlog_normals greater than 24`, por exemplo, o painel receberá apenas os tickets que atendem a essa condição, mesmo que o widget TOTAL Tickets mostre todo o backlog.

Nas capturas de referência, o Data Export também diverge do widget em dois grupos:

- usa `[cancelado]KP-Normal-AfterSales-Br` em vez de `KP-Normal-AfterSales-Br`;
- não contém `KP-Normal-Creatorcommerce-Br`.

Para reproduzir o widget TOTAL Tickets, crie um novo Data Export em `Analytics > Settings > Data Exports` com os mesmos filtros do widget:

1. `Status includes New, Open, On-hold`;
2. `Tag name does not include zd_migrated_tickets, migrated_tickets`;
3. `Ticket ID greater than 23200921`, somente se esse corte ainda fizer parte do widget;
4. `Group name includes` exatamente os mesmos grupos ativos do widget;
5. `Requester email is anything` é neutro e pode ser mantido;
6. remova `Backlog_normals greater than 24` para trazer todo o backlog normal.

Inclua pelo menos as colunas `Ticket ID`, `Agent name` e `Status`. O importador lê todas as linhas, elimina Ticket IDs duplicados e agrupa os tickets por agente e status.

O Freshdesk informa que um Data Export agendado não pode ser editado. Quando os filtros mudarem, exclua o agendamento antigo, crie outro e copie a nova URL de API. Confira também filtros de data no nível do widget, da página e do relatório, pois divergências entre esses níveis alteram o resultado exportado.

## Variáveis da Vercel

Configure em `Production`:

```env
CEC_FRESHDESK_API_KEY=API_KEY_DO_FRESHDESK
CEC_FRESHDESK_REPORT_URL=https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=UUID_DO_NOVO_EXPORT
CRON_SECRET=SEGREDO_DA_ROTINA_VERCEL
```

A API Key fica em `Freshdesk > Profile settings`. A URL do relatório é o endpoint de API fornecido pelo Data Export e retorna o link do arquivo mais recente. Não use cookie ou `x-auth-token` da sessão do navegador.

O cron `/api/cron/realtime-cec` executa nos minutos `00` e `30`. O botão `Refresh` da tela força uma nova leitura do arquivo dentro do ciclo atual. Se o próprio Data Export for gerado apenas uma vez por hora, os dois ciclos podem ter a mesma quantidade; para obter dados diferentes a cada 30 minutos, a origem também precisa gerar um arquivo nessa frequência.

## Validação depois da troca

1. aguarde o Freshdesk gerar o primeiro arquivo do novo agendamento;
2. abra o endpoint configurado e confirme que ele retorna um objeto `export.url`;
3. no painel CEC, clique em `Refresh`;
4. compare o total, os status e os grupos com o widget no mesmo horário;
5. use o seletor de ciclos do CEC para conferir os snapshots anteriores.

Erros de autenticação, permissão, limite de chamadas ou arquivo inválido não apagam o último snapshot válido.
