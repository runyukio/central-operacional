# Implementation Log - 2026-06-12

## Resumo

Implementacao do pacote WFH ADS/CEC, Mural de Avisos, filtros em lote por WB/Login e ajustes operacionais de Performance, Mapa de Funcionarios, Cronogramas e datas padrao.

## Arquivos principais alterados

- `src/lib/wfh-rules.ts`
- `src/lib/default-date-range.ts`
- `src/lib/batch-wb-filter.ts`
- `src/lib/performance-service.ts`
- `src/lib/employee-service.ts`
- `src/lib/employee-profile-service.ts`
- `src/lib/settings-service.ts`
- `src/lib/mural-service.ts`
- `src/components/modules.tsx`
- `src/lib/navigation.ts`
- `src/app/(app)/mural/page.tsx`
- `src/app/api/mural/posts/route.ts`
- `src/app/api/mural/posts/[id]/route.ts`
- `src/app/api/mural/posts/[id]/status/route.ts`
- `src/app/api/mural/birthdays/route.ts`
- `src/app/api/performance/route.ts`
- `src/app/api/performance/export/route.ts`
- `src/app/api/employees/route.ts`
- `prisma/schema.prisma`
- `prisma/migrations/202606121200_mural_posts/migration.sql`

## WFH

- Regra centralizada em `src/lib/wfh-rules.ts`.
- WFH agora avalia elegibilidade somente para LOBs ADS e CEC.
- TNS, Video e Comments retornam `NOT_APPLICABLE`/`Nao aplicavel` e nunca aparecem como `Qualificado`.
- Status de elegibilidade implementados: `QUALIFIED`, `NOT_QUALIFIED`, `NOT_APPLICABLE`, `INSUFFICIENT_DATA`.
- Status auxiliar de monitoramento implementado: `NOT_MONITORED`, `AT_RISK`, `RETURN_REQUIRED`.
- ADS: tempo de casa maior que 2 meses, qualidade >= 95 nas ultimas 3 semanas, Submit medio/dia >= 350, AHT <= 60s, ABS <= 5%, nenhuma ausencia injustificada.
- CEC: qualidade >= 90, Submit/CPD >= 70, ABS <= 5%, nenhuma ausencia injustificada.
- Disciplina, SLA CEC e status atual real de WFH ficaram como criterios estruturados de dados insuficientes quando nao houver base confiavel conectada.
- Motivos de nao qualificacao ficam disponiveis no detalhe do agente e no tooltip da coluna WFH.
- Exportacao Performance inclui motivos WFH, monitoramento e faltas injustificadas.

## Mural

- Criado modulo `/mural` com feed visual, cards com imagem/capa ou placeholder por tipo de conteudo.
- Reaproveitado `Announcement` como base persistida.
- Adicionados campos de Mural em migration: tipo de conteudo, URLs externas, publico-alvo por role/LOB, prioridade, expiracao, arquivamento e role do autor.
- CLIENT permanece sem acesso ao Mural; segue restrito a Performance.
- ADMIN gerencia no MVP; demais perfis internos visualizam posts publicados destinados ao role/LOB.
- Capa do aviso pode ser enviada para Supabase Storage pelo bucket publico `mural-media`.
- Upload da capa abre recorte visual 16:9 antes de salvar, gerando imagem final em 1200x675.
- URLs externas continuam permitidas para imagem, midia e anexos.
- Aniversarios usam `EmployeeSensitiveData.birthDate`, mostrando apenas dia/mes, nome e LOB.

## Filtros em lote

- Criado parser reutilizavel em `src/lib/batch-wb-filter.ts`.
- Aceita quebra de linha, virgula, ponto e virgula, tab, espacos extras e remove duplicados case-insensitive.
- Aplicado em Performance e Mapa de Funcionarios.
- UI mostra chips removiveis, limpar todos e aviso de WB/Login nao encontrado.
- APIs recebem `wbLogins` e combinam com os filtros existentes.

## Status e Performance

- Performance oculta `Desligado` por padrao.
- `Afastado` voltou como status oficial de colaborador nas opcoes e filtros.
- Desligados podem ser exibidos quando filtrados explicitamente.
- Regra por data de desligamento continua usando a data final do periodo como referencia.

## Datas padrao

- Criado `getDefaultDateRange()` com timezone `America/Sao_Paulo`.
- Padrao: primeiro dia do mes ate ontem.
- Se hoje for dia 1, usa o mes anterior completo.
- Aplicado aos filtros analiticos que dependiam do mes operacional.

## Mapa de Funcionarios

- Lista de supervisores em `/api/settings` agora vem de consulta propria, sem `take: 500` da lista geral.
- A regra considera cargo, role e colaboradores que ja supervisionam alguem.
- Status do supervisor e normalizado antes de bloquear inativos/desligados.

## Cronogramas

- Adicionadas contagens compactas por colaborador na grade:
  - Escala: `Escalado`, `Presente`, `Atraso`, `Saida antecipada`, `Troca aprovada`, `Venda de folga aprovada`, `Nesting`.
  - Folga: `Folga`, `Folga aprovada`.
- Contadores aparecem como pills compactos sem alterar dados ou calculos.

## Scroll e layout

- Tabelas e modais novos usam `overflow-auto`/`max-height` para evitar corte.
- Batch addition usa area com scroll local para muitos chips.
- Mural usa layout responsivo com feed e lateral em desktop, empilhado em telas menores.

## Validacoes executadas

- `npx prisma generate`: aprovado.
- `npm run typecheck`: aprovado.
- `npm run build`: aprovado.

## Limitacoes e pendencias

- Historico disciplinar ainda nao possui base confiavel conectada para WFH; criterio retorna dados insuficientes quando necessario.
- SLA CEC ainda nao possui base confiavel conectada; criterio retorna dados insuficientes quando necessario.
- Status atual real de quem ja esta em WFH nao possui base confiavel conectada; monitoramento fica `NOT_MONITORED` ate a base existir.
- Upload de capa do Mural foi implementado via Supabase Storage. Videos, anexos e outras midias seguem por URL externa para evitar upload inseguro fora do bucket controlado.

## Proximos passos recomendados

- Conectar base oficial de disciplina e SLA CEC para reduzir `Dados insuficientes`.
- Conectar status oficial de colaborador em WFH para ativar monitoramento/retorno automatico.
- Avaliar liberacao granular de publicacao no Mural para RH/WFM/Supervisor.

---

# Implementation Log - 2026-06-15 - Requerido STAFF

## Resumo

Adicionada uma segunda visao na aba Requerido com alternancia por botoes `AGENTS` e `STAFF`.

## Arquivos principais alterados

- `src/components/modules.tsx`
- `src/lib/required-staff-service.ts`
- `src/app/api/staff-coverage/staff/route.ts`

## AGENTS

- A visao `AGENTS` continua usando a API existente `/api/staff-coverage`.
- Importacao, exportacao, filtros e detalhe de agentes foram preservados.
- A logica de requerido operacional de agentes nao foi alterada.

## STAFF

- Criada API `GET /api/staff-coverage/staff`.
- A visao `STAFF` calcula cobertura com base na escala do periodo filtrado.
- Supervisores, POCs e RTAs sao identificados pela `skill` do colaborador.
- Normalizacoes contemplam `Supervisor`, `Sup`, `TL`, `Team Leader`, `Supervisao`, `POC`, `Ponto Focal`, `RTA` e `Real Time`.
- Apenas LOBs `ADS`, `CEC` e `TNS` entram no heatmap.

## Regras implementadas

- Turnos fixos considerados: `Manha`, `Tarde` e `Noite`.
- O turno `Noite` e mantido como turno do dia da escala, evitando deslocar o registro para o dia seguinte.
- Regra minima geral: cada data + turno deve ter pelo menos 1 Supervisor na empresa.
- POC e RTA nao substituem a regra minima de Supervisor.
- Cobertura por LOB:
  - Verde: Supervisor + POC.
  - Amarelo: apenas Supervisor ou apenas POC.
  - Vermelho: sem Supervisor e sem POC.
- RTA aparece como cobertura complementar ao ativar o botao `COM RTA`.
- Pessoas de folga, ferias, afastadas, desligadas, ausentes ou sem turno valido nao contam como cobertura.

## Dias mais criticos

- Criado quadro com os 10 pontos mais criticos.
- A ordenacao prioriza:
  - turno sem Supervisor na empresa;
  - falha em final de semana;
  - LOB sem Supervisor e sem POC;
  - coberturas parciais;
  - ausencia de RTA como agravante complementar.

## Visual

- Mantido o padrao atual de cards, filtros, tabelas, badges e paineis.
- Adicionados cards resumidos para turnos com/sem Supervisor, cobertura completa/parcial/sem cobertura e risco em final de semana.
- Heatmap usa cores suaves consistentes com o restante do sistema.

## Validacoes executadas

- `npm run typecheck`: aprovado.
- `npm run build`: aprovado.

## Pendencias

- Validacao visual manual em ambiente local ainda recomendada com dados reais de escala.

## Ajuste posterior - 2026-06-15

- RTA passou a ser tratado como cobertura geral do turno, cobrindo ADS, CEC e TNS ao ativar `COM RTA`.
- RTAs deixam de depender da LOB cadastrada para entrar na analise de staff.
- `Video`, `Comments` e variacoes passam a ser normalizados como TNS para cobertura de Supervisor/POC.
- A deteccao de Supervisores por skill foi ampliada para variações como `Leader`, `Lider`, `Lideranca`, `TeamLeader`, `TL`, `Sup`, `Supervisor` e `Supervisao`.
- A lista geral de Supervisor/RTA remove duplicidade quando o mesmo RTA cobre as tres LOBs.
- A cobertura STAFF considera somente registros de escala com status `Escalado`, `Presente` ou `Venda de folga aprovada`.
