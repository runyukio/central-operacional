# Falhas observadas no legado e prevenção na V2

| Falha observada | Causa | Prevenção V2 |
|---|---|---|
| HTTP 401 | token diferente do servidor ou DPAPI copiado entre máquinas | segredo individual, enrollment e HMAC |
| `Instalar.vbs` com caractere inválido | UTF-8 BOM / Windows Script Host | instalador PowerShell assinado e MSI futuro |
| script complementar não encontrado | execução direta de ZIP | pacote instalado por artefato único ou MSI |
| tarefa não criada | principal/grupo incorreto e falha silenciosa | usuário interativo explícito, verificação pós-criação |
| `Count` não encontrado | objeto único sob StrictMode | arrays normalizados e testes de 0/1/N |
| `Arguments` não encontrado | ações heterogêneas no Task Scheduler | acesso defensivo a propriedades |
| navegador sem domínio | UI Automation não confiável | extensão Chromium + Native Messaging |
| extensão capturou domínio, agente não leu | diretórios por usuário/contexto diferentes | diretório único em ProgramData e contrato versionado |
| duas versões enviando | upgrade não idempotente | mutex, remoção explícita e verificação de uma instância |
| banco crescendo rapidamente | heartbeat bruto append-only | current state upsert + segmentos + resumo diário |
| pacote com credencial | token global embutido | nenhum segredo no instalador; enrollment temporário |
| diagnóstico dependia de texto formatado | parsing de `Format-List` | JSON estruturado em `-mode diagnose` |
