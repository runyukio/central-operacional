# Report CEC pela API Freshdesk

O backend consulta diretamente a API do Freshdesk, grava um snapshot por bloco de 30 minutos e mantem o ultimo snapshot valido caso a fonte falhe. O cookie nunca e enviado ao navegador.

## Variaveis da Vercel

Configure em Production:

```env
CEC_FRESHDESK_REPORT_URL=https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d
CEC_FRESHDESK_COOKIE=COOKIE_COMPLETO_DA_REQUISICAO_AUTENTICADA
CRON_SECRET=SEGREDO_DA_ROTINA_VERCEL
```

O cron `/api/cron/realtime-cec` consulta a API nos minutos `00` e `30`. A propria tela tambem tenta preencher o bloco atual ao ser aberta, sem repetir a consulta quando o ciclo ja existe.

## Automacao Windows opcional

O script Windows continua disponivel como contingencia caso a consulta precise ser executada fora da Vercel.

### Arquivos locais

Crie `C:\Users\SEU_USUARIO\.freshdesk_cookie` com o valor completo do header `Cookie` copiado da requisicao autenticada do Freshdesk.

Crie `C:\Users\SEU_USUARIO\.cec_env`:

```env
REALTIME_SITE_URL=https://eastriverbrasil.com
REALTIME_IMPORT_TOKEN=SEU_TOKEN_TECNICO
CEC_UPLOAD_ENABLED=true
CEC_NORMAL_REPORT_URL=https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d
```

### Teste manual

No PowerShell, dentro do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-cec-scheduled-report.ps1
```

O resultado local fica em `C:\Users\SEU_USUARIO\CEC`. O script reconhece arquivos JSON, CSV ou XLSX com os headers `ticket`, `agent name` e `status`.

### Agendamento

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-cec-scheduled-report-task.ps1
```

Isso cria tarefas nos minutos `00` e `30` de cada hora. Os logs ficam em `C:\Users\SEU_USUARIO\CEC\logs`.

Para remover:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-cec-scheduled-report-task.ps1
```

Quando o Freshdesk encerrar a sessao, atualize somente o arquivo `.freshdesk_cookie`.
