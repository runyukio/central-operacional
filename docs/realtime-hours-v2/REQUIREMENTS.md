# Requisitos funcionais e não funcionais

## Captura

- Presença e heartbeat a cada 300 segundos.
- Amostragem local do contexto a cada 2 segundos.
- Fechamento local de segmento em troca de site, aplicativo, bloqueio, inatividade ou usuário.
- Upload em lote a cada 300 segundos.
- Reenvio automático após indisponibilidade.
- Uma única instância por sessão.
- Dado da extensão aceito somente quando recente e correspondente ao navegador em primeiro plano.

## Navegadores

- Chrome e Edge obrigatórios.
- Brave opcional, condicionado à política corporativa.
- Somente hostname é enviado.
- Navegação privada é registrada como `PRIVATE`, sem domínio.

## Central

- Supervisor enxerga apenas a equipe vinculada.
- WFM, Coordenação, Gerência e Admin seguem escopo operacional.
- API e interface aplicam a mesma autorização.
- A visualização atual pode ser reutilizada, mas deve migrar para endpoints V2 paginados.

## Banco e custo

- Estado atual: uma linha por dispositivo, atualizada por upsert.
- Histórico detalhado: uma linha por segmento fechado, não por amostra.
- Retenção detalhada padrão: 7 dias.
- Resumo diário: retenção mínima de 12 meses.
- Heartbeat bruto não deve crescer indefinidamente.
- Timeline paginada; nunca retornar milhares de linhas sem necessidade.

## Segurança

- Sem segredo global no pacote.
- Enrollment por código temporário.
- Segredo individual por dispositivo, derivado no servidor e protegido por DPAPI no Windows.
- Assinatura HMAC de cada request.
- Revogação individual por dispositivo.
- Logs sem token, segredo, URL completa ou conteúdo.
- Binário e extensão assinados antes de rollout amplo.

## Operação

- Instalação idempotente.
- Upgrade remove legado e preserva fila válida.
- Diagnóstico gera JSON estruturado.
- Desinstalação remove tarefa, processos, native host e políticas criadas pelo produto.
- Rollback documentado.
