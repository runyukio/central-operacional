# Categorias de Performance > Qualidade

A seleção TNS reúne os registros KAP de VIDEO e COMMENTS. A qualidade continua sendo a divisão dos casos corretos distintos pelos casos auditados distintos no escopo selecionado, sem fazer média dos percentuais das LOBs.

TNS, VIDEO e COMMENTS têm o filtro de categoria: Todas, Push, User, Comments e Video. A classificação depende do ID da fila auditada, independentemente da LOB do agente. Os IDs informados estão em `src/lib/performance-quality.ts`.

O Excel usa o mesmo período, LOB, categoria, visão e ordenação da consulta da tela. Contém Resumo, Evolução e Agentes. A busca por nome, WB ou supervisor restringe somente a aba Agentes, como na tela. A exportação exige a permissão existente de Performance e inclui todos os agentes correspondentes, sem o antigo corte de 500 linhas.

## Publicação e dados existentes

1. Incluir a migração `202611101600_quality_queue_id` na publicação. Ela adiciona `QualityRecord.queueId` como opcional e seu índice; os registros existentes são preservados.
2. Aplicar essa migração pelo fluxo de publicação do banco antes de liberar o código que consulta o novo campo.
3. Reimportar a base KAP de VIDEO/COMMENTS contendo `audit_queue_id` ou `queue_id`. As importações normais e por lotes passam a guardar esse campo.

Os snapshots anteriores não guardavam o ID da fila. A migração não consegue reconstruí-lo: casos antigos continuam em Todas, com aviso de casos sem categoria, até a reimportação. Filas com ID desconhecido também entram em Todas e ficam fora das quatro categorias.

A publicação desta alteração mantém o snapshot já carregado. A classificação do histórico depende de uma futura importação com ID da fila; não é inferida pelo cadastro do agente.

## Validação

- 52 testes passaram, incluindo importação com IDs numéricos e ausentes, filtros de TNS/ADS/CEC, permissões e leitura do Excel gerado com 601 agentes.
- TypeScript, lint dos arquivos alterados e compilação de produção passaram.
- A interface real foi conferida em navegador com respostas simuladas: troca das quatro categorias, remoção dos filtros em ADS e download com categoria, período e busca corretos.
- Em 390 px de largura a página não apresenta rolagem horizontal; a tabela de agentes mantém sua própria rolagem.
- A migração foi conferida no banco de produção: campo, índice e registro no histórico Prisma. O snapshot existente é preservado.
