# Report Executivo ADS por webhook

O report Executivo de ADS e gerado no servidor como PNG e enviado automaticamente pelo cron da Vercel no minuto 15 de cada hora.

## Configuracao

Cadastre as variaveis abaixo no ambiente de producao da Vercel:

```env
ADS_EXECUTIVE_WEBHOOK_ENABLED=true
ADS_EXECUTIVE_WEBHOOK_URL=https://seu-webhook
ADS_EXECUTIVE_WEBHOOK_TOKEN=
ADS_EXECUTIVE_WEBHOOK_PAYLOAD_MODE=multipart
ADS_EXECUTIVE_WEBHOOK_TIMEOUT_MS=30000
CRON_SECRET=seu-segredo-do-cron
```

`ADS_EXECUTIVE_WEBHOOK_URL` e `ADS_EXECUTIVE_WEBHOOK_TOKEN` tambem aceitam, como fallback, `PROJECT_WEBHOOK_URL` e `PROJECT_WEBHOOK_TOKEN`.

Depois de alterar as variaveis, faca um novo deploy para que a funcao use a configuracao atualizada.

## Formato padrao: multipart

O envio usa `POST multipart/form-data` com estes campos:

- `file`: imagem PNG do report;
- `reportType`: `ADS_EXECUTIVE`;
- `cycle`: ciclo mais recente do Real Time;
- `date`: data do report no formato `YYYY-MM-DD`;
- `metadata`: JSON com ciclo, data, horario de geracao e tipo do arquivo.

Os headers incluem:

- `Authorization: Bearer <token>`, quando um token estiver configurado;
- `Idempotency-Key: ads-executive:<ciclo>`;
- `X-Report-Type: ADS_EXECUTIVE`.

## Formato JSON opcional

Use `ADS_EXECUTIVE_WEBHOOK_PAYLOAD_MODE=json` quando o destino exigir JSON. Nesse modo, a imagem e enviada no campo `imageBase64`, junto com `fileName`, `mimeType` e os metadados do report.

## Execucao manual

O mesmo endpoint pode ser acionado manualmente para validar a integracao:

```bash
curl -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  https://SEU_DOMINIO/api/cron/ads-executive-report
```

Quando `ADS_EXECUTIVE_WEBHOOK_ENABLED=false`, o endpoint responde com sucesso e informa que o envio foi ignorado.

## Conteudo da imagem

A imagem usa o ultimo ciclo valido do Real Time e inclui:

- Submit, Input, agentes online e backlog;
- heatmap horario com deltas do ciclo;
- Input x Forecast;
- backlog ao longo do dia;
- maior e menor producao da ultima hora.

O Forecast vem da base de Performance e a necessidade de HC vem da necessidade horaria de ADS.
