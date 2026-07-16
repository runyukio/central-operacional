# Automacao do Report CEC

O Report CEC e atualizado no computador Windows da automacao. O cookie do Freshdesk nunca e enviado ao navegador nem armazenado no site.

## Arquivos locais

Crie `C:\Users\SEU_USUARIO\.freshdesk_cookie` com o valor completo do header `Cookie` copiado da requisicao autenticada do Freshdesk.

Crie `C:\Users\SEU_USUARIO\.cec_env`:

```env
REALTIME_SITE_URL=https://eastriverbrasil.com
REALTIME_IMPORT_TOKEN=SEU_TOKEN_TECNICO
CEC_UPLOAD_ENABLED=true
CEC_NORMAL_REPORT_URL=https://kuaishousupport.freshdesk.com/reports/schedule/download_file.json?uuid=333f3cd9-ec65-4aae-9817-b6fcee4efa4d
```

## Teste manual

No PowerShell, dentro do projeto:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\download-cec-scheduled-report.ps1
```

O resultado local fica em `C:\Users\SEU_USUARIO\CEC`. O script reconhece arquivos JSON, CSV ou XLSX com os headers `ticket`, `agent name` e `status`.

## Agendamento

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-cec-scheduled-report-task.ps1
```

Isso cria tarefas nos minutos `00` e `30` de cada hora. Os logs ficam em `C:\Users\SEU_USUARIO\CEC\logs`.

Para remover:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-cec-scheduled-report-task.ps1
```

Quando o Freshdesk encerrar a sessao, atualize somente o arquivo `.freshdesk_cookie`.
