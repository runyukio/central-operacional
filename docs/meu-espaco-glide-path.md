# Meu Espaço — metas, Requerido e Glide path

## Segurança e histórico

- As APIs usam o usuário ativo do banco e o escopo existente do Meu Espaço. Gestor consulta; supervisor responde no próprio escopo; ADM/WFM preservam permissões.
- `SpaceCoverageNote` é aditiva e append-only na aplicação. Guarda responsável, autor, horário e fotografia do requerido/disponível. Reenvio com o mesmo UUID é idempotente; conteúdo diferente não reutiliza UUID.
- RLS e remoção de grants de `PUBLIC`, `anon` e `authenticated` impedem acesso direto. Apenas a aplicação no servidor grava as notas.
- O estado do alerta é calculado a cada consulta, sem automação: cobertura suficiente ou fim do turno o encerram, mesmo sem nota. Turnos noturnos usam a data inicial e o fim no dia seguinte, no horário de São Paulo. A leitura não muda cronogramas nem justificativas originais.
- Requerido reaproveita a elegibilidade de Necessidade. A cobertura é de toda a LOB/turno; o mesmo alerta pode ter vários supervisores, mas é contado uma única vez no consolidado. Cadastro/requerido ausente gera aviso.

## Métricas e projeção

- Fórmulas originais permanecem. Metas são comparadas usando numeradores e denominadores antes do arredondamento, com diferenças percentuais em pontos percentuais.
- Meta ADS 300: somente skill principal Material Queues. AHT/latência TNS: somente filas VIDEO de SLA 15 minutos; Comments é separado. FRT CEC mantém Normal separado de P0 + HM.
- Corte: último dia com denominador válido no mês, anterior a hoje. O Dashboard mantém os dados parciais de hoje.
- Ritmo: sete dias corridos até o corte, incluindo o mês anterior quando necessário. Somente dias-parceiro com escala elegível **e base válida** entram no ritmo; parceiros/datas ausentes não viram produção zero.
- Volumes de avaliações, submits e primeiras respostas: denominador observado por dia-parceiro escalado com base, aplicado à escala elegível futura. Produtividade/CPD usam dias-parceiro elegíveis; ABS mantém o denominador atual da escala.
- Overall = soma dos numeradores / soma dos denominadores. Esforço restante = `(meta × (denominador realizado + restante) − numerador realizado) / restante`, respeitando unidades e limites. Contagens necessárias são arredondadas conservadoramente para unidades inteiras.
- Projeção aplica o ritmo recente ao volume restante. O caminho necessário usa o esforço calculado. Lacunas ficam sem dado; cenários acima dos limites possíveis são sinalizados como inviáveis.
- Override de volume é apenas simulação da consulta, nunca persiste em base, escala ou meta. Mês encerrado não apresenta esforço futuro.
- Horas preservam a visão mensal e os cálculos atuais, incluindo complemento de turno em andamento. Ordenação numérica acontece antes da paginação de 50 parceiros; pendências usam cursor por data/tipo/ID, inclusive em bancos não-UTC.

## Validação

`tsx --test src/lib/meu-espaco*.test.ts src/components/meu-espaco/*.test.tsx`

`scripts/qa-meu-espaco.ts` exige `MEU_ESPACO_LOCAL_QA=1` e um PostgreSQL **local**, banco `quality_qa`, com schema/migração instalados. Ele cria somente fixtures sintéticas nesse banco e verifica escopo, fechamento, histórico, idempotência concorrente, 61 parceiros/paginação, metas ponderadas e projeção. Nunca apontar fixtures para produção.

Build, tipos, lint e testes HTTP por ADM/WFM/gestor/supervisor completam a conferência. A migração não altera dados históricos operacionais.
