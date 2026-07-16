# Report CEC pela API oficial do Freshdesk

O backend consulta a API v2 oficial do Freshdesk com uma API Key permanente, grava um snapshot por bloco de 30 minutos e mantém o último snapshot válido caso a fonte falhe. Nenhuma credencial é enviada ao navegador.

## Variáveis da Vercel

Configure em `Production`:

```env
CEC_FRESHDESK_DOMAIN=kuaishousupport.freshdesk.com
CEC_FRESHDESK_API_KEY=API_KEY_DO_FRESHDESK
CRON_SECRET=SEGREDO_DA_ROTINA_VERCEL
```

A API Key fica em `Freshdesk > Profile settings`, abaixo da seção de alteração de senha. Não use o JWT `x-auth-token` do Freshreports: ele pertence à sessão do navegador e expira.

O cron `/api/cron/realtime-cec` consulta a API nos minutos `00` e `30`. A própria tela também tenta preencher o bloco atual ao ser aberta, sem repetir a consulta quando o ciclo já existe.

## Recorte do Backlog Normal

Por padrão, o sistema consulta grupos cujo nome contém `normal` e exclui grupos P0. Para travar o recorte pelos IDs oficiais, configure:

```env
CEC_FRESHDESK_GROUP_IDS=123456,789012
```

Os IDs são validados antes da coleta. Se um ID estiver incorreto, o upload é recusado e o último snapshot válido permanece no painel.

Outras configurações opcionais:

```env
# Um ou mais trechos de nome separados por vírgula, usados quando GROUP_IDS está vazio.
CEC_FRESHDESK_GROUP_NAME_PATTERN=normal

# Use "agent" para agrupar a rosca por agente ou "group" para agrupar pelo grupo Freshdesk.
CEC_FRESHDESK_BREAKDOWN_BY=agent

# Sobrescreve os status quando a conta usa códigos customizados.
CEC_FRESHDESK_STATUS_MAP={"2":"Open","3":"On Hold","6":"New"}
```

Sem `CEC_FRESHDESK_STATUS_MAP`, a rotina lê `/api/v2/ticket_fields` e identifica automaticamente Open, Pending/On Hold e New.

## Proteções de consistência

- Tickets são consultados por grupo e status para reduzir risco de truncamento.
- Todas as páginas são carregadas e os tickets são deduplicados pelo ID.
- Se a busca exceder o limite de 300 registros por grupo/status, o snapshot é recusado em vez de publicar uma contagem parcial.
- Erros de autenticação, permissão, rate limit ou formato não apagam o último snapshot válido.
- Cookie, `x-auth-token` e link assinado do Freshreports não fazem parte deste fluxo.
