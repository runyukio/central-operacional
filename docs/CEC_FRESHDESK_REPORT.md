# Report CEC: CPD por hora

O relatório `Real Time > Report > CEC` usa o Data Export agendado do Freshdesk:

```text
https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d
```

## Regra do indicador

- Grão: snapshot horário + agente.
- CPD do agente: contagem distinta de `Ticket ID` dentro de `Agent name`.
- CPD total: soma do CPD dos agentes.
- Média por agente: CPD total dividido pela quantidade de agentes com CPD.
- Linhas repetidas do mesmo `Ticket ID` para o mesmo agente contam uma vez.
- Se um ticket aparecer associado a agentes diferentes no mesmo arquivo, ele conta uma vez para cada agente.

O arquivo atual contém apenas `Ticket ID`, `Agent name` e `Status`; ele não informa o horário do ticket. Por isso, “por hora” representa o horário em que o snapshot foi coletado, e não a hora de criação ou resolução do ticket.

## Rotina cloud

O cron `/api/cron/realtime-cec` roda uma vez por hora e grava o arquivo mais recente como snapshot daquele horário. Nenhuma automação local é necessária.

Variáveis de produção:

```env
CEC_FRESHDESK_API_KEY=API_KEY_DO_CRIADOR_DO_DATA_EXPORT
CEC_FRESHDESK_REPORT_URL=https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d
CRON_SECRET=SEGREDO_DA_ROTINA_VERCEL
```

O endpoint do Freshdesk vincula o agendamento ao usuário que o criou. Uma API Key de outro usuário pode responder `require_login`, mesmo sendo válida para a API Core v2. Não use cookies do navegador, chaves em código ou automações do computador.

## Validação

O importador exige as colunas `Ticket ID`, `Agent name` e `Status`, aceita CSV/XLSX, rejeita arquivos vazios ou maiores que 10 MB e mantém o último snapshot válido quando a origem falha.
