# Revisão de desempenho — 02/11/2026

## Resultado e abrangência

A revisão encontrou trabalho duplicado depois de salvar Cronogramas e aprovar
Horas Operacionais, leituras repetidas em Atividades e uma falha na reutilização
de cálculos lentos. As correções estão nesta alteração. O principal risco
estrutural restante é a reconstrução de capturas históricas na pontualidade.

Base: `main` em `7c17c89`. Foram inspecionados os três fluxos citados, seus
consumidores, consultas compartilhadas, navegação, autenticação, polling,
configurações, processamento histórico, estatísticas do PostgreSQL e logs reais
da Vercel. O inventário contém 46 arquivos de páginas e 190 rotas de API; o build
verificou a aplicação completa. A investigação detalhada concentrou-se nos
fluxos citados e nos maiores custos encontrados nos registros de produção.

As consultas de diagnóstico em produção foram somente leitura. As mudanças
não exigem migration, alteração de infraestrutura ou exclusão de histórico.
Não foram realizadas alterações de cronograma nem aprovações reais como teste.

## Evidências anteriores às correções

| Evidência | Observação |
| --- | --- |
| Capturas de horas | Aproximadamente 5,06 milhões de linhas vivas estimadas em `pg_stat_user_tables`. |
| Cronogramas | Logs `schedules.list`: 751 ms para 2.250 células de cronograma e 1.559 ms para 510 células, em requisições diferentes. |
| Indicadores de presença | Logs `attendance.summary-only`: aproximadamente 750–823 ms. |
| Pontualidade mensal | Dois logs `realtime-hours.punctuality` de 30 dias: 53.582 e 56.498 ms; todos os dias reconstruídos da base bruta. |
| Arquivos diários de captura | 109 dias consolidados, de 08/07 a 24/10, com processamento em 02/11. A presença de um arquivo não garante que sua assinatura ainda corresponda às referências atuais. |
| Consulta individual de captura | `EXPLAIN ANALYZE` para uma janela de 36 horas: cerca de 115 ms; 500 linhas retornadas e 67.345 descartadas pelo filtro de identidade. |

Os tempos são amostras reais, não percentis de uma carga controlada. Contagens e
estatísticas acumuladas do banco servem para priorizar investigação; não
representam exclusivamente a versão atual nem comprovam regressão recente.

## Correções implementadas

### Cronogramas

- A gravação passa a retornar o registro confirmado. Foram removidas a consulta
  global de presença sem período e a recarga de uma grade mensal que o cliente
  descartava; essa grade ainda calculava outro resumo.
- O editor conclui depois do commit. A recarga usa a página, o período e os
  filtros aplicados mais recentemente, em segundo plano.
- Leituras antigas são canceladas e não sobrescrevem uma seleção mais recente.
- A paginação reaproveita os indicadores do mesmo período e filtros.
- Histórico, auditoria, permissões, presença e sincronização de horas permanecem
  nas mesmas transações. Foi acrescentada a medição `schedules.edit`.

### Horas Operacionais

- Resumo e leitura da página/capturas avançam em paralelo.
- Consultas de usuário, ajustes, cronograma e revisão de horas extras projetam
  apenas os campos utilizados, evitando objetos e documentos desnecessários.
- Aprovar/recusar aplica o registro retornado pelo servidor imediatamente após
  a confirmação. A atualização do painel acontece em segundo plano, mantendo
  as horas capturadas exibidas até a reconciliação.
- Uma falha nessa atualização preserva os dados e informa que a decisão já
  foi salva. A atualização respeita filtros alterados durante o processamento.
- A transação de decisão continua `Serializable`, com validação do estado do
  ajuste. O botão impede a repetição enquanto a decisão está pendente.

### Atividades

- Resumo, lista de agentes e rankings compartilham uma janela diária
  materializada em uma única consulta e um mesmo snapshot do banco.
- O agente identificado usa igualdade direta em `employeeId`, aproveitando o
  índice existente. Foi preservada a regra exata de sobreposição de intervalos.
- A tela carrega até 5.000 intervalos somente ao abrir a linha do tempo.
  Resumos e rankings continuam calculados sobre o dia completo.
- Comparação real das consultas antiga/nova no mesmo snapshot: resumo e
  agentes idênticos para 1.025 intervalos e 29 agentes. Buffers consultados:
  1.156 nas duas consultas antigas contra 590 na consolidada. O tempo SQL ficou
  semelhante, aproximadamente 11 ms. O ganho medido é a redução de leitura
  repetida e de viagens ao banco; não foi demonstrado ganho de latência SQL
  nessa amostra pequena.
- A retenção atual de atividades foi preservada: por padrão, a importação
  remove os intervalos anteriores a sete dias, respeitando a configuração
  existente. Guardar meses/anos de sites e aplicativos requer uma decisão
  específica de retenção e armazenamento. Isso é diferente do histórico
  preservado de captura de horas.

### Reutilização de cálculos lentos

O cache compartilhado expirava 15 segundos após o início da consulta, mesmo
quando ela ainda estava executando por mais de 50 segundos. Agora o mesmo
cálculo em andamento é reutilizado, e a validade de 15 segundos começa quando
o resultado fica pronto. Limites de tamanho, separação por escopo, invalidação
e remoção de falhas foram preservados. Isso reduz duplicação concorrente; o
custo de uma reconstrução histórica individual ainda precisa ser reduzido.

## Próximas prioridades para crescimento

1. **Pontualidade histórica:** a assinatura dos consolidados inclui todos os
   cadastros, vínculos, turnos e LOBs. Uma mudança cadastral pode invalidar muitos
   dias. A correção estrutural é calcular dependências por dia/equipe e atualizar
   somente os consolidados afetados, com versionamento e testes de equivalência.
   Reutilizar arquivos desatualizados sem validação comprometeria os resultados.
2. **Períodos extensos:** a rota de métricas de supervisores aceita até 366 dias;
   dias sem consolidação válida são reconstruídos em grupos de quatro. Esse
   trabalho deve ser pré-calculado ou processado em lotes fora da requisição
   interativa, com progresso e resultado consistente.
3. **Capturas por identidade:** avaliar índice funcional compatível com
   `LOWER(wbLogin)` e a data, usando planos representativos e o custo adicional
   de escrita sobre milhões de capturas. Os índices comuns existentes não
   resolvem todos os filtros com normalização de texto.
4. **Dados de apoio:** telas que precisam apenas de LOBs/turnos usam a consulta
   geral de Configurações, com múltiplas listas e até 500 colaboradores. Uma
   leitura específica de opções reduziria o trabalho na navegação.
5. **Interface:** a busca global tem atraso de digitação, mas não cancela todas
   as respostas antigas. No build desta revisão, Performance e Real Time
   apresentam os maiores carregamentos iniciais de JavaScript: 291 e 256 kB.
   Medir o uso das abas antes de dividir os componentes mais pesados.

Referência de método: [otimização de consultas no Supabase](https://supabase.com/docs/guides/database/query-optimization).
Os próximos índices devem ser escolhidos por planos medidos e consultas atuais.

## Validação e limites

- Prisma Client gerado no ambiente isolado; TypeScript completo, ESLint dos
  arquivos alterados e build de produção passaram. O build gerou as 142 páginas
  estáticas previstas.
- Suíte completa: 1.309 testes passaram, nenhum falhou e três foram ignorados
  pelos critérios já existentes, em 163 arquivos de teste.
- Testes cobrem mudanças de filtro durante salvamento, respostas antigas,
  aprovação confirmada seguida de falha de leitura, consultas paralelas,
  permissões por equipe, limites, fusos horários e validade do cache lento.
- SQL de Atividades validado em produção por `EXPLAIN ANALYZE` e comparação
  antiga/nova somente leitura. Nenhuma alteração foi feita no banco.
- Navegador local: login abriu sem erros/avisos de console. As três APIs
  protegidas retornaram 401 sem sessão. Fluxos autenticados foram validados
  pelos testes automatizados; não houve sessão autenticada de navegador para
  medir o tempo de interação real desses fluxos.
- Não houve teste de carga com múltiplos usuários nem medição de antes/depois
  das gravações autenticadas em produção. Os tempos após publicação precisam
  ser acompanhados nos logs, incluindo `schedules.edit`.
- Os testes completos detectaram quatro falhas já presentes em `main` no mock
  de exportação de ausências. O cenário foi reproduzido na versão original e o
  mock passou a incluir a leitura de auditoria exigida pelo serviço atual.
  Nenhuma regra de exportação foi alterada para esse ajuste de teste.
