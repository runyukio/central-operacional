# Manutenção V2 com custo e impacto limitados

## O que esta alteração faz

A limpeza de nonces fica separada dos resumos históricos. Cada passagem remove no máximo 5.000 nonces cujo `expiresAt` passou há mais de dez minutos. O TTL já é de dez minutos e a assinatura aceita no máximo cinco minutos de diferença do relógio. A margem adicional preserva tokens além da janela de autenticação. A seleção ordena pelo índice `expiresAt`, usa `FOR UPDATE SKIP LOCKED` e limita espera de bloqueio a 500ms e a instrução a cinco segundos.

O novo job `realtime-hours-v2-nonce-cleanup` executa uma passagem por minuto dentro do próprio Postgres, sem chamada HTTP, token no repositório ou função Vercel. O teto é 5.000/minuto (7,2M/dia). Na observação de 09/11 havia cerca de 198k nonces/dia e pico observado de 15,9k/h, aproximadamente 264/minuto. O teto supera esse ingresso em cerca de 19 vezes. Um estoque de 1,5M levaria aproximadamente 5h20 nesse teto com ingresso simultâneo; duração real e bloqueios devem ser observados, não garantidos.

O job persiste apenas a última execução bem-sucedida e sua contagem em `WorkstationMaintenanceStateV2`. Falhas ficam em `cron.job_run_details`; o próprio job mantém somente seus registros dos últimos sete dias. A tabela nova guarda apenas chave de manutenção, JSON com datas/fingerprints/contagens e horário. Tem RLS e acesso somente ao runtime V2 conhecido; `anon` e `authenticated` não recebem acesso. Nenhuma permissão em `SystemConfig` é ampliada.

## Aplicação desta operação

1. Confirmar o banco V2 e executar as verificações de leitura em `scripts/realtime-hours-v2-maintenance-preflight.sql`, inclusive `EXPLAIN` sem `ANALYZE`. Em 09/11 a branch já tinha `pg_cron` 1.6.4 disponível e pré-carregado, mas a extensão não estava instalada.
2. Aplicar somente o SQL revisado de `prisma/migrations/20261109210000_realtime_hours_v2_nonce_maintenance/migration.sql` por um administrador no banco V2. O arquivo é idempotente: a tabela é criada se necessário e o mesmo nome de job atualiza o agendamento existente.
3. Esta branch não possui `_prisma_migrations`: foi inicializada pelo histórico Supabase. **Não executar `prisma migrate deploy` sobre todo o repositório nesta branch.** Registrar esta operação específica no histórico Supabase e reconciliar/baselinar os dois históricos antes de integrar a branch ou adotar Prisma para sua implantação completa.
4. Executar uma passagem inicial revisada com `scripts/realtime-hours-v2-nonce-cleanup.sql`, conferir a contagem e a ausência de impacto nos tokens recentes e observar o job. O estoque é eliminado em lotes, sem um DELETE de 1,5M linhas de uma vez.

A documentação oficial instala `pg_cron` no schema `pg_catalog`; o módulo é suportado no Supabase hospedado. A disponibilidade e o preload foram verificados nesta branch. Nenhum serviço externo precisa de segredo para esse agendamento. Fontes: [instalação](https://supabase.com/docs/guides/cron/install), [funcionamento e histórico dos jobs](https://supabase.com/docs/guides/cron).

A migração utiliza os privilégios que o criador da extensão já possui. Não concede permissões adicionais no schema `cron` nem em tabelas de outros jobs. Após a aplicação, conferir a execução real; se faltar uma permissão, identificar o objeto e a operação exatos antes de propor uma concessão específica.

## API de manutenção e resumos

A rota existente exige o mesmo `CRON_SECRET` por Bearer. Aceita `?task=nonces`, `?task=history` ou `?task=all` (padrão). O modo de nonces na API faz até quatro transações de 5k, respeitando orçamento de tempo; deve ser usado apenas em recuperação ou onde o agendador SQL não existe, sem duplicar o agendamento regular. O retorno indica `moreMayRemain` quando outra passagem pode ser necessária.

O modo histórico calcula uma assinatura dos campos que afetam cada resumo, sem nomes ou identificadores nos logs. Só dias alterados são reconstruídos, no máximo oito por chamada, começando pelos mais recentes. Uma repetição idêntica que apenas atualiza `updatedAt` não recompõe o dia; correções de identidade/contexto, intervalo ampliado e chegada tardia alteram a assinatura. O recorte normal cobre quinze dias mais o dia atual, coerente com a janela de ingestão de quatorze dias. Um backfill explícito via helper `includeAllDates: true` pode cobrir datas mais antigas; os dados brutos permanecem disponíveis.

Cada data tem transação e lock próprios, resumo e checkpoint publicados juntos e uma fotografia consistente da fonte. Se a fonte tem menos segmentos que o resumo/checkpoint anterior, o resumo é preservado e o retorno sinaliza a lacuna. Não há `DELETE` de atividade, dispositivos ou códigos nesta otimização. A manutenção anterior agregava oito dias e apagava detalhe anterior a sete dias; isso não era compatível com a ingestão tardia de quatorze dias e podia apagar dados nunca consolidados no preview. Uma retenção destrutiva futura exige uma política própria e verificação de arquivo completo.

O limite da rota combinada passa a 120s para comportar as transações limitadas separadamente; isso não agenda execuções adicionais. O agendamento Vercel existente `30 6 * * *` corresponde a 06:30 UTC (03:30 São Paulo) e só é executado em produção, portanto não mantinha esta implantação preview. O job SQL resolve os nonces no ambiente onde os dados são gravados. A rotina histórica continua disponível para chamada autorizada e futura promoção; ela não deve ser agendada por minuto.

## Verificação e suspensão

Depois da aplicação, conferir somente metadados/contagens:

```sql
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname = 'realtime-hours-v2-nonce-cleanup';
SELECT status, return_message, start_time, end_time FROM cron.job_run_details
WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'realtime-hours-v2-nonce-cleanup')
ORDER BY start_time DESC LIMIT 10;
SELECT "key", "value", "updatedAt" FROM public."WorkstationMaintenanceStateV2"
WHERE "key" = 'realtime-hours-v2-maintenance:last:nonces-sql';
```

Para suspender, desativar apenas esse job (`cron.alter_job(jobid, active := false)`) após identificar seu ID. Não desinstalar `pg_cron`, pois isso removeria todos os jobs. Remoção de nonces já expirados não tem rollback necessário para a autenticação; dados de atividade não são removidos.

Os testes isolados usam Postgres local em memória (PGlite), nunca um banco operacional. Cobrem o limite estrito do TTL, batches, persistência, recorte à meia-noite de São Paulo, no-op semântico, correções e dados tardios, preservação de fonte incompleta, idempotência do DDL, RLS e a instrução agendada real. PGlite 0.5.15 é uma dependência de desenvolvimento fixada no manifesto e no lockfile. Seu import é obrigatório: se faltar no ambiente de CI, a suíte falha em vez de pular os testes SQL.
