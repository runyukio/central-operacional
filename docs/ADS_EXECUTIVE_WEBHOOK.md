# Report Executivo ADS por webhook

O report Executivo de ADS e gerado no servidor como PNG e enviado automaticamente pelo cron da Vercel no minuto 55 de cada hora.

O report adicional `ADS Online Productivity` usa o mesmo webhook e e enviado no minuto 58 de cada hora. Todo o conteudo visivel da imagem e do payload e gerado em ingles.

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

## KwaiTalk / Kim Robot

Para o robot do KwaiTalk, configure:

```env
ADS_EXECUTIVE_WEBHOOK_PAYLOAD_MODE=kwaitalk
```

Nesse modo, a imagem e sobrescrita em um unico objeto publico no bucket `mural-media`, evitando acumulo de arquivos. O webhook recebe um `POST` JSON no contrato Kim (`msgtype=markdown`) com o ciclo, o horario de geracao e a imagem incorporada por URL. Respostas HTTP de sucesso do robot sao aceitas, incluindo as variantes de retorno Kim com `code: 0` ou `code: 200`.

O bucket publico `mural-media` e as variaveis `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` devem estar configurados em producao.

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

## ADS Online Productivity

O segundo report usa apenas os agentes ADS considerados online pelo mesmo criterio do Executive: presenca online, presenca no cronograma ou atividade no intervalo atual.

A imagem inclui:

- media de submit por hora da operacao;
- AHT medio do intervalo atual;
- soma do submit acumulado no shift date;
- ranking completo dos agentes online, do maior para o menor submit do intervalo;
- comparacao percentual com o intervalo anterior;
- submit acumulado no shift date e AHT medio de cada agente.

O endpoint do cron e `/api/cron/ads-online-productivity-report` e o agendamento em `vercel.json` e `58 * * * *`.

## TNS Online Productivity

O report TNS segue o mesmo layout e a mesma cadencia do ADS, usando o webhook ja configurado para VIDEO:

```env
VIDEO_EXECUTIVE_WEBHOOK_ENABLED=true
VIDEO_EXECUTIVE_WEBHOOK_URL=https://seu-webhook
VIDEO_EXECUTIVE_WEBHOOK_PAYLOAD_MODE=kwaitalk
```

O conteudo e gerado integralmente em ingles e inclui:

- parceiros ativos de VIDEO e COMMENTS considerados presentes no intervalo;
- somente parceiros com submit maior que zero no ranking e nas medias;
- media ponderada de submit por parceiro e por skill;
- AHT ponderado somente para VIDEO, seguindo a regra operacional das filas de 15 minutos;
- moderacao do intervalo atual, total do turno e comparacao com o intervalo anterior;
- badges distintas para VIDEO e COMMENTS.

O endpoint do cron e `/api/cron/tns-online-productivity-report` e o agendamento em `vercel.json` e `58 * * * *`.
