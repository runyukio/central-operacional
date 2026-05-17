# Central Operacional

Plataforma interna para escala, solicitações, esteiras, cadastro de colaboradores, mapa de funcionários, report de turno, presença/ausência, performance, mural, qualidade, equipamentos, staff e cobertura, clima, feedback anônimo, tokens, auditoria e configurações.

O projeto está preparado para teste real 100% local com Postgres via Docker, Prisma e Next.js. Futuramente pode ser publicado na Vercel com Supabase, mas isso não é necessário para validar os fluxos agora. O visual segue os mockups anexados: sidebar azul-marinho, fundo claro, cards brancos, filtros no topo, tabelas limpas, badges coloridos, gráficos executivos e painéis laterais.

## Stack

- Next.js App Router 14
- React + TypeScript
- Tailwind CSS
- Prisma ORM
- PostgreSQL local via Docker para testes reais
- NextAuth Credentials com usuários do banco local
- Storage local temporário em `storage/local`
- Zod
- Recharts
- Lucide React
- SheetJS/xlsx
- TanStack Table como dependência preparada

## Arquitetura Recomendada

- GitHub: repositório e branch `main` para produção.
- Vercel: hospedagem do Next.js, API routes, preview deploys e domínio `.vercel.app`.
- Supabase Pro: PostgreSQL, Auth, Storage, backups e logs básicos.
- Notificações: internas no app, sem e-mail transacional nesta versão.
- Observabilidade: logs da Vercel, logs do Supabase, `AuditLog` e `ErrorLog` internos.

## Instalação Local

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Acesse `http://localhost:3000/login`.

## Rodando E Testando 100% Localmente

Este é o fluxo recomendado agora, sem Supabase, Vercel, domínio, e-mail, storage externo ou dados demo.

1. Instale as dependências:

```bash
npm install
```

2. Crie o `.env` local na raiz:

```bash
cp .env.example .env
```

O `.env` local esperado é:

```bash
APP_ENV="local"
USE_LOCAL_DB="true"
ALLOW_DEMO_LOGIN="false"
ALLOW_DEMO_DATA="false"
NEXT_PUBLIC_ENABLE_DEMO_USERS="false"
ALLOW_DEMO_SEED="false"
DATABASE_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
DIRECT_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="central-local-secret-change-later"
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
INITIAL_ADMIN_EMAIL="admin@central.com"
INITIAL_ADMIN_PASSWORD="Central@123"
INITIAL_COLLABORATOR_PASSWORD="Central@123"
```

3. Suba o Postgres local:

```bash
npm run db:up
```

4. Teste a conexão:

```bash
npm run db:check
```

5. Rode migrations:

```bash
npx prisma migrate dev
```

6. Rode o seed mínimo real:

```bash
npx prisma db seed
```

7. Abra o Prisma Studio, se quiser conferir tabelas:

```bash
npx prisma studio
```

8. Rode a aplicação:

```bash
npm run dev
```

9. Acesse:

```text
http://localhost:3000
```

10. Login admin local:

```text
admin@central.com
Central@123
```

Fluxo real para testar:

- criar cadastro público de colaborador
- aprovar cadastro como admin
- importar escala real de maio/2026
- logar como colaborador aprovado
- validar Minha Escala
- criar solicitação de folga
- aprovar primeira etapa como supervisor/admin
- aprovar etapa final como WFM/admin
- validar mudança em Minha Escala e Escalas Consolidadas
- conferir notificações, histórico e auditoria

Para resetar o banco local e recriar a base mínima:

```bash
npm run db:reset-local
```

Para parar o banco local:

```bash
npm run db:down
```

Uploads em modo local não usam Supabase Storage. Arquivos válidos são gravados em `storage/local` e o banco guarda metadados/caminho local.

## Variáveis De Ambiente

Obrigatórias para teste local:

```bash
APP_ENV="local"
USE_LOCAL_DB="true"
ALLOW_DEMO_LOGIN="false"
ALLOW_DEMO_DATA="false"
NEXT_PUBLIC_ENABLE_DEMO_USERS="false"
ALLOW_DEMO_SEED="false"
INITIAL_ADMIN_EMAIL="admin@central.com"
INITIAL_ADMIN_PASSWORD="Central@123"
INITIAL_COLLABORATOR_PASSWORD="Central@123"
DATABASE_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
DIRECT_URL="postgresql://central:central123@localhost:5432/central_operacional?schema=public"
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="central-local-secret-change-later"
```

Não use chaves reais no código. Configure secrets somente no `.env` local e no painel da Vercel.

## Banco, Migrations E Seed

Scripts disponíveis:

```bash
npm run db:generate
npm run db:up
npm run db:down
npm run db:check
npm run db:pull
npm run db:migrate
npm run db:deploy
npm run db:seed
npm run db:seed:local
npm run seed:demo
npm run seed:prod
npm run seed:local
npm run db:clear-demo
npm run db:reset-local
npm run db:reset-demo
npm run db:studio
```

Local:

```bash
npm run db:up
npm run db:check
npm run db:migrate -- --name init
npm run db:seed
```

Produção:

```bash
npm run db:check
npm run db:deploy
```

O seed demo é bloqueado em produção quando `APP_ENV=production` ou `NODE_ENV=production`, salvo se `ALLOW_DEMO_SEED=true` for definido explicitamente em ambiente controlado.

Para iniciar um piloto real sem massa fake:

```bash
npm run seed:prod
# ou, se já havia demo carregada:
npm run db:clear-demo
npm run seed:prod
```

`seed:prod` mantém somente estrutura mínima: roles, turnos, LOBs base e usuário Admin inicial. `seed:demo` e `db:reset-demo` continuam disponíveis apenas para apresentações.

## Como Iniciar Teste Real Sem Dados Demo

Use este caminho quando quiser validar do zero, sem agentes ou escalas fictícias:

1. Configure `.env` com `ALLOW_DEMO_LOGIN=false`, `ALLOW_DEMO_DATA=false` e `NEXT_PUBLIC_ENABLE_DEMO_USERS=false`.
2. Rode `npm run db:migrate` no local ou `npm run db:deploy` no ambiente conectado ao Supabase.
3. Rode `npm run db:clear-demo` se já existiam dados demonstrativos.
4. Rode `npm run seed:prod` para manter somente roles, permissões, turnos, tipos de solicitação, LOBs básicas e o admin inicial.
5. Acesse com `admin@central.com` e a senha configurada em `INITIAL_ADMIN_PASSWORD`.
6. Crie um cadastro real pela tela pública de cadastro de colaborador.
7. Aprove o cadastro como Admin/RH/WFM. O usuário criado usa `INITIAL_COLLABORATOR_PASSWORD` como senha inicial.
8. Importe uma escala real em `Escalas Consolidadas` usando datas de maio de 2026.
9. Valide o vínculo por `wb_login` ou `email`.
10. Entre como colaborador e confira `Minha Escala`; ela lê a mesma tabela `Schedule` usada por `Escalas Consolidadas`.
11. Crie uma solicitação de folga.
12. Aprove a primeira etapa como Supervisor/Admin, levando o status para `Em análise`.
13. Aprove a etapa final como WFM/Admin; só nessa etapa a escala é alterada.

O mês padrão de teste é maio de 2026 (`01/05/2026` a `31/05/2026`). Se a planilha tiver datas fora desse mês, a importação preserva a data e gera aviso para conferência, em vez de criar dados artificiais.

Para recriar a massa de apresentação visual:

```bash
npm run seed:demo
```

Para resetar tudo e recriar a demo em ambiente local controlado:

```bash
npm run db:reset-demo
```

`db:clear-demo` remove colaboradores, usuários de demonstração, escalas, solicitações, notificações, reports, performance, feedbacks, equipamentos, clima, tokens e logs de teste. Ele preserva admin, roles, permissões, tipos de solicitação, turnos, LOBs básicas e configurações essenciais.

## Supabase

Supabase não é necessário no modo local. Esta seção fica apenas para a migração futura para produção online.

1. Crie um projeto no Supabase.
2. Em `Project Settings > API`, copie a Project URL para `NEXT_PUBLIC_SUPABASE_URL`.
3. Em `Project Settings > API`, copie a anon public key para `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Em `Project Settings > API`, copie a service role key para `SUPABASE_SERVICE_ROLE_KEY`.
5. Em `Project Settings > Database > Connection string`, copie a string do pooler/transação para `DATABASE_URL`.
6. Em `Project Settings > Database > Connection string`, copie a string direta para `DIRECT_URL`.
7. Se a senha do banco tiver caracteres como `@`, `#`, `%`, `/`, `?`, `&` ou `+`, aplique URL encoding antes de colar na URL.
8. Rode `npm run db:check` para testar host, porta e `SELECT 1` via Prisma.
9. Rode `npm run db:deploy`.

Exemplo para runtime/Vercel usando Supabase Transaction Pooler:

```bash
DATABASE_URL="postgresql://postgres.PROJECT_REF:URL_ENCODED_PASSWORD@aws-0-REGION.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&sslmode=require"
```

Exemplo para migrations usando conexão direta:

```bash
DIRECT_URL="postgresql://postgres:URL_ENCODED_PASSWORD@db.PROJECT_REF.supabase.co:5432/postgres?sslmode=require"
```

Se sua rede/ambiente não tiver IPv6 para a conexão direta do Supabase, use a string de `Session Pooler` no `DIRECT_URL` durante migrations.

Comandos úteis de diagnóstico:

```bash
npx prisma validate
npx prisma generate
npm run db:check
npx prisma db pull
npx prisma migrate dev
npx prisma migrate deploy
```

O erro atual mais comum é o `.env` ainda apontar para `localhost:5432` sem um Postgres local ativo. Nesse caso, suba o Postgres local ou substitua `DATABASE_URL` e `DIRECT_URL` pelas strings reais do Supabase.

Buckets privados esperados no Supabase Storage:

- `schedule-imports`
- `request-attachments`
- `quality-materials`
- `equipment-evidence`
- `employee-documents`
- `absence-evidence`
- `shift-report-attachments`

Todos devem ser privados. Uploads passam por validação de extensão, tamanho, vínculo de entidade, usuário responsável e auditoria.

Limites:

- Escala Excel: 10 MB
- Anexo de solicitação: 10 MB
- Evidência de ausência: 5 MB
- Evidência de equipamento: 10 MB
- Documento cadastral: 5 MB
- Material de qualidade: 30 MB
- Report de turno: 10 MB

## Vercel

Configuração do projeto:

- Framework: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output: padrão Next.js
- Production branch: `main`
- Preview deploys: habilitados

Passos:

1. Suba o projeto no GitHub.
2. Importe o repositório na Vercel.
3. Configure as variáveis de ambiente em `Production`, `Preview` e `Development`.
4. Faça o deploy.
5. Use o link padrão, por exemplo `central-operacional.vercel.app`.

## Domínio

O app funciona primeiro com domínio Vercel. Para domínio próprio:

1. Abra o projeto na Vercel.
2. Vá em `Settings > Domains`.
3. Adicione `centraloperacional.com.br`, `central.suaempresa.com.br`, `portal.suaempresa.com.br` ou similar.
4. No Registro.br, aponte os DNS conforme a Vercel indicar.
5. Para subdomínio corporativo, crie um CNAME para `cname.vercel-dns.com`.
6. Atualize `NEXTAUTH_URL` para o domínio final.

## Autenticação E Permissões

A autenticação aceita Supabase Auth por e-mail/senha e mantém uma camada NextAuth para sessão da aplicação. O usuário precisa existir ativo no banco da Central para acessar. `ALLOW_DEMO_LOGIN=false` é o padrão recomendado para piloto real; defina `ALLOW_DEMO_LOGIN=true` e `NEXT_PUBLIC_ENABLE_DEMO_USERS=true` apenas quando quiser liberar os usuários de demonstração.

Perfis:

- `COLLABORATOR` / `COLABORADOR`
- `SUPERVISOR`
- `WFM`
- `QUALITY` / `QUALIDADE`
- `HR` / `RH`
- `LOGISTICS_IT` / `TI`
- `MANAGEMENT` / `GESTOR`
- `ADMIN`

Helpers implementados em `src/lib/permissions.ts`:

- `canViewEmployeeSensitiveData`
- `canEditSchedule`
- `canApproveRequest`
- `canViewTeam`
- `canViewShiftReport`
- `canManageEquipment`
- `canAccessAuditLogs`
- `canViewSensitiveFile`
- `canManageAttendance`
- `canJustifyAbsence`

## LGPD E Dados Sensíveis

Dados sensíveis ficam separados no schema e devem ser exibidos apenas para perfis autorizados:

- CPF, RG, CNPJ
- endereço, CEP, telefones
- contato de emergência
- data de nascimento
- dados bancários e PIX
- informações familiares
- documentos anexados
- evidências de ausência
- feedbacks anônimos

Listagens usam máscaras como CPF `***.***.***-12`, conta `****-8` e PIX parcialmente oculto.

## Notificações Internas

Não há e-mail transacional obrigatório nesta versão. O header tem sino, contador de não lidas, painel de notificações, links de ação e marcação como lida.

Eventos que geram notificações internas:

- cadastro enviado, aprovado, recusado ou ajuste solicitado
- solicitação criada, aprovada, recusada ou concluída
- troca de folga aprovada/recusada
- ausência registrada ou pendente
- report de turno enviado
- comunicado publicado/lido
- feedback de qualidade enviado
- equipamento/chamado atualizado
- resgate de tokens solicitado

## AuditLog E ErrorLog

`AuditLog` registra ações sensíveis, incluindo cadastros, aprovações, uploads, alteração de escala, presença/ausência, comunicação, equipamentos, tokens e permissões.

`ErrorLog` registra erros importantes como login, upload, importação, criação/aprovação de solicitação, escala, cadastro, presença, report, permissão e acesso negado. A página `/uso-plataforma` mostra erros recentes para Admin/Gestão.

## Uso Da Plataforma

A rota `/uso-plataforma` é restrita a Admin/Gestão e mostra:

- usuários ativos
- total de colaboradores
- arquivos enviados
- storage estimado
- solicitações
- importações de escala
- reports de turno
- audit logs
- notificações internas
- error logs
- alertas de uso crescente

## Usuários De Teste

Senha demo: `Central@123`. Estes usuários são criados por `seed:demo`. No teste local real, use `db:seed` ou `seed:local`, que cria apenas `admin@central.com` por padrão. Colaboradores aprovados no fluxo real recebem a senha inicial configurada em `INITIAL_COLLABORATOR_PASSWORD`.

| Usuário | Perfil |
| --- | --- |
| `admin@central.com` | Admin |
| `gestor@central.com` | Gestão |
| `supervisor@central.com` | Supervisor |
| `colaborador@central.com` | Colaborador |
| `wfm@central.com` | WFM |
| `qualidade@central.com` | Qualidade |
| `rh@central.com` | RH |
| `ti@central.com` | Logística/TI |

## Funcionalidades Disponíveis

- Login e logout.
- Menus por perfil e proteção de rotas.
- Solicitações usam API Prisma-first, criação real, filtros, detalhe, histórico, comentários, ações de status, notificações e auditoria básica.
- Esteira kanban busca solicitações pela API, organiza apenas pelos status oficiais, abre detalhe clicável e atualiza visualmente a coluna após aprovar, recusar, concluir ou cancelar.
- Bloco 2 funcional: notificações internas usam API Prisma-first, sino com contador, painel recente, marcar uma ou todas como lidas e links para a entidade relacionada.
- Correção focada: `Solicitar Folga` em Minha Escala abre modal funcional com três modalidades: troca de folga, venda de folga e solicitação de dia de folga. Todas validam campos obrigatórios, criam solicitação real, notificam aprovadores e aparecem em Minhas Solicitações, Solicitações e Esteiras.
- Correção focada: `Editar Escala` em Escalas Consolidadas abre modal, salva status/turno/horários/observação no banco, registra `ScheduleChangeHistory`, `AttendanceRecord` quando aplicável e `AuditLog`.
- Correção focada: `Marcar presença/ausência` aceita `Presente`, `Folga`, `Férias`, `Treinamento`, `Troca aprovada` e `Sem escala` sem motivo obrigatório; exige motivo apenas para ausência/falta/atraso/saída antecipada/afastado/erro de escala.
- Cadastro público de colaborador com aprovação.
- Mapa de funcionários com seções sensíveis por permissão.
- Central Operacional com presença, gaps e riscos calculados a partir da base real; sem massa real, mostra zero/empty state.
- Minha Escala com calendário e Minhas Solicitações vindos da mesma base real de escala/solicitação.
- Escalas com upload Excel real, preview, validação contra colaboradores/turnos, importação parcial, edição manual e presença/ausência.
- Solicitações em lista e kanban com mudança de status e histórico.
- Aprovação de troca de folga, venda de folga e solicitação de dia de folga segue fluxo Supervisor -> WFM e aplica a alteração na escala somente na aprovação final do WFM.
- Mural com comunicados, leitura e aniversariantes.
- Performance, qualidade, equipamentos, staff, clima, feedback anônimo, tokens, chat, relatórios e auditoria.
- Report de turno com dashboard, briefing simples, export CSV/JSON e copiar resumo para IA.
- Upload local temporário grava arquivos em `storage/local` quando `USE_LOCAL_DB=true`.
- Notificações internas, `AuditLog`, `ErrorLog` e uso da plataforma.

## O Que Ainda Está Mockado Ou Preparado Para Fase Futura

- Solicitações, troca de folga, edição de escala, presença/ausência, comentários, importação de escala e notificações usam Prisma/Postgres local no modo `USE_LOCAL_DB=true`. Se `ALLOW_DEMO_LOGIN=false` e `ALLOW_DEMO_DATA=false`, não há fallback demo nas telas principais.
- Parte das demais telas ainda usa dados demonstrativos para composição visual. Estes módulos não foram alterados nesta etapa.
- Performance, mural, qualidade, clima, equipamentos, staff, tokens e chat não foram avançados nesta etapa; permanecem no estado anterior por decisão de escopo.
- Supabase Auth e Supabase Storage ficam desligados no modo local; a sessão usa NextAuth com usuários do banco local.
- Nem todos os botões de anexo das telas chamam o endpoint de upload ainda.
- CRUD profundo de configurações, SLAs, permissões e regras de aprovação ainda é parcialmente demonstrativo.
- Não há e-mail transacional nem monitoramento externo nesta versão.
- Briefing de report usa regra simples; IA nativa fica para fase futura.

## Status Oficiais E Fluxo De Folgas

Status oficiais da esteira:

- `Aberto`
- `Em análise`
- `Aprovado`
- `Recusado`
- `Concluído`
- `Cancelado`

Mapeamentos de legado:

- `Pendente` -> `Aberto`
- `Aguardando aprovação` -> `Em análise`
- `Ajuste solicitado` -> `Em análise`
- `Finalizado` -> `Concluído`

Fluxo de folgas:

1. Colaborador cria solicitação. Status inicial: `Aberto`. A solicitação aparece em Minha Escala/Minhas Solicitações e na Esteira do supervisor.
2. Supervisor aprova primeira etapa. Status: `Em análise`. A escala ainda não muda. WFM recebe notificação.
3. WFM aprova etapa final. Status: `Aprovado`. A escala é atualizada em transação, com histórico, auditoria e notificações.
4. WFM/Admin pode marcar como `Concluído` depois do ajuste aplicado.

Regras:

- Colaborador vê apenas a própria escala, as próprias solicitações e notificações.
- Colaborador pode cancelar solicitação própria enquanto estiver `Aberto`.
- Supervisor vê solicitações do próprio time quando o vínculo `supervisorId` existe e pode aprovar/recusar a primeira etapa.
- WFM/Admin/Gestão podem ver o fluxo completo; WFM faz aprovação final e aplica a escala.
- Aprovação de folga é idempotente: múltiplos cliques não geram múltiplos históricos, auditorias ou notificações. A escala só é aplicada uma vez.
- Se a escala não tiver as datas necessárias ou os status não baterem com a regra, a API devolve mensagem amigável e não aprova parcialmente.

## Importação De Escala Real

Template mínimo:

- `wb_login`
- `data`
- `status`
- `turno`
- `entrada`
- `saida`
- `lob`
- `supervisor_wb_login`
- `observacao`

Regras atuais:

- A escala é vinculada exclusivamente por `wb_login` existente e ativo na base de funcionários.
- Se o `wb_login` não existir, a linha aparece como erro para correção; o sistema não cria colaborador fake nem escala órfã.
- Para status `Escalado` ou `Presente`, `turno`, `entrada` e `saida` são obrigatórios.
- Não cria duplicidade de escala para o mesmo colaborador/data; a importação atualiza o registro existente.
- Minha Escala e Escalas Consolidadas leem a mesma tabela `Schedule`.
- Alteração feita por edição manual ou aprovação final WFM aparece nas duas telas.

## Ajustes Recentes Do Piloto Local

- Cadastro público agora coleta senha e confirmação; apenas o hash é salvo no banco.
- Painel de cadastros permite selecionar uma pessoa na esteira, aprovar, recusar, solicitar ajuste e remover/inativar cadastro com soft delete.
- Aprovação mostra mensagens de validação específicas quando faltam dados operacionais como WB/Login ou Time.
- Admin pode resetar senha manualmente pelo Mapa de Funcionários, sem e-mail transacional.
- Cargo/Função operacional do colaborador pode ser alterado sem mudar automaticamente a role/permissão de sistema.
- Em Minha Escala, `Resumo de Horas` e `Comunicados Recentes` ficam em empty state enquanto não houver dados reais.
- Escalas Consolidadas agora usa mês/ano selecionável, filtros reais, edição por célula, legenda de cores por status e ação para remover a escala de um colaborador sem excluir o cadastro.
- Central Operacional calcula escalados, presentes, ausentes e ABS a partir de `Schedule`/`AttendanceRecord`, sem contar colaboradores sem escala como escalados.
- Mapa de Funcionários remove colunas fake de qualidade/produtividade, permite exportar CSV, editar cargo/status operacional e alterar role de sistema como Admin.
- Removidos os filtros rápidos globais e a data/hora fixa do shell; cada página deve exibir apenas filtros próprios e funcionais.
- Minha Escala não usa mais fallback para o primeiro colaborador: ela mostra somente a escala do usuário logado ou empty state.
- Central Operacional agora possui filtro por range (`startDate` e `endDate`) com atalhos de hoje, semana, mês e mês anterior; os indicadores recalculam pela escala real do período.
- Mapa de Funcionários corrige permissões de Admin para detalhes/dados sensíveis e não seleciona automaticamente o primeiro colaborador.
- Minha Escala/Minhas Solicitações usa `/api/requests?scope=mine`, então Admin só vê solicitações próprias nessa área pessoal; o consolidado continua em Solicitações/Esteiras.
- Cadastros ganhou importação em massa por Excel: baixe o template, suba a planilha, valide preview/erros e confirme a importação de colaboradores aprovados/ativos.
- Na importação de colaboradores, `criar_usuario = sim` exige `senha_temporaria`; a senha é armazenada somente como hash e deve ser comunicada manualmente pelo Admin.
- CPF é opcional na importação de colaboradores. Quando vazio, a linha entra com alerta de `CPF pendente` e o Admin/RH pode completar depois; quando preenchido, o CPF continua validado e duplicidade ativa continua bloqueando a linha.
- Duplicidades ativas de e-mail ou WB/Login bloqueiam a linha; CPF preenchido duplicado também bloqueia. Cadastros recusados/inativos podem ser reaproveitados pela importação.
- Login atualizado para apresentação do MVP local: novo subtítulo, botão `Criar cadastro`, sem cards de status fake e com wallpaper local em `public/login-wallpaper.png`.
- Central Operacional agora combina range de datas com filtro real de LOB vindo do banco; os indicadores usam `Schedule`/`AttendanceRecord` filtrados por período e LOB.
- Aprovação de cadastro normaliza `Pendente de Cadastro` para `Ativo`, ativa o `User`, reabre `EmployeeProfile` soft-deletado quando houver vínculo e mantém o Mapa refletindo colaborador aprovado.
- Escalas Consolidadas passou a carregar colaboradores ativos reais nos selects, permitindo adicionar escala manual para colaborador aprovado sem Schedule prévio.
- Sidebar do Supervisor foi reduzida ao escopo do MVP: Central Operacional, Minha Escala, Escalas, Solicitações, Esteiras, Report de Turno e Mapa de Funcionários.
- Supervisor fica restrito à primeira etapa de solicitações de folga; aprovação final e aplicação da escala continuam com WFM/Admin/Gestão.
- Configurações do Admin deixou de ser estática: Admin cria/edita/inativa LOBs, turnos e cargos/funções, altera mês padrão local e visualiza roles/tipos de solicitação com persistência e AuditLog.
- A aprovação cadastral usa as LOBs, turnos e cargos ativos configurados pelo Admin nos selects operacionais.

### Configurações ADMIN e permissões de escala

- A rota `/configuracoes` fica visível e acessível apenas para `ADMIN`; acesso direto por outro perfil redireciona para a Central Operacional.
- A API de Configurações permite gravação apenas para `ADMIN`. Perfis não admin recebem somente opções operacionais limitadas, como LOBs, turnos e tipos ativos para filtros e formulários.
- Configurações agora persistem no banco e geram `AuditLog` para usuários, perfis, permissões, LOBs, times, vínculos de supervisão, turnos, cargos/funções, tipos de solicitação, SLAs, regras de aprovação, regras de cobertura, regras de tokens e parâmetros gerais.
- Admin pode criar/editar/inativar usuários, resetar senha temporária pela edição do usuário, alterar role, vincular `EmployeeProfile`, criar LOBs, times, turnos, cargos e parametrizar regras.
- Supervisores podem ser vinculados a times ou colaboradores em Configurações e também no Mapa de Funcionários. O vínculo passa a alimentar filtros, mapa, escala e esteiras.
- Em Escalas, `WFM`, `ADMIN` e `GESTOR` podem importar Excel, adicionar escala manual, editar escala completa e marcar `Presente`.
- Em Escalas, `SUPERVISOR` visualiza a grade, mas não vê upload/adicionar escala e não consegue executar importação, adição ou edição completa via API.
- Supervisor só registra justificativas de ocorrência (`Ausente`, `Falta`, `Atraso`, `Saída antecipada`, `Afastado`, `Erro de escala`) em `AttendanceRecord`; ele não altera turno, entrada, saída, folga ou presença.
- As justificativas do Supervisor geram `AttendanceHistory`, `AuditLog` e passam a impactar os indicadores reais da Central Operacional por período/LOB.
- Mapa de Funcionários permite acesso operacional para `SUPERVISOR`, mas a API não carrega dados sensíveis para esse perfil e o detalhe exibe apenas dados operacionais.
- A tela de login não inicializa mais `admin@central.com`/senha por código e não renderiza cartões de usuários demo; credenciais precisam ser digitadas manualmente.
- WFM/Admin podem marcar `Falta`, `Ausente`, `Atraso`, `Saída antecipada`, `Afastado` ou `Erro de escala` como "sem justificativa no momento"; a célula fica destacada, o Supervisor recebe pendência/notificação e a Central Operacional contabiliza pendências de justificativa.
- Quando o Supervisor justifica a ocorrência, o sistema exige motivo e observação, grava `AttendanceHistory`, `AuditLog`, notifica WFM/Admin e mantém a ocorrência impactando ABS conforme a regra do registro.
- Cadastros aprovados podem ser ajustados administrativamente pelo Mapa de Funcionários. Admin edita identificação, WB/Login, LOB, time, supervisor, turno, escala, cargo, status, contrato, datas, site/operação, role, status de acesso e observações sem recriar colaborador.
- WFM e RH usam a mesma manutenção pós-aprovação com escopo reduzido por perfil: WFM para dados operacionais e RH para dados cadastrais/contratuais autorizados.
- APIs críticas passaram a retornar erro estruturado com `type`, `message` e `fieldErrors`, incluindo validações, duplicidades, permissões e relacionamentos inválidos.
- A edição de colaborador no Mapa preserva os dados preenchidos, destaca campos inválidos e substitui a mensagem genérica por erros como `LOB é obrigatória`, `WB/Login já está em uso` ou `Supervisor selecionado não existe`.
- A exportação CSV do Mapa agora sai pelo backend em `/api/employees/export`, respeita filtros aplicados e aplica colunas por perfil: `ADMIN` exporta dados completos disponíveis; `SUPERVISOR` exporta apenas dados operacionais sem dados sensíveis.
- Importação de colaboradores exige `wb_login` como chave operacional principal; linhas com `wb_login` existente atualizam o colaborador. Upload de escala e horas continua cruzando por WB/Login, sem depender de CPF.
- Importação de escala não usa mais nome ou e-mail como fallback: cada linha precisa de `wb_login` existente em `EmployeeProfile`; linhas sem vínculo falham no preview com erro por linha/campo.
- Usuários criados por importação com `senha_temporaria` e senhas resetadas pelo Admin ficam com `mustChangePassword=true` e `temporaryPassword=true`; no próximo login são redirecionados para `/alterar-senha`.
- A tela de login possui o link `Primeiro acesso ou senha temporária? Alterar senha`, permitindo trocar senha sem e-mail transacional ao informar e-mail, senha atual, nova senha e confirmação.
- A troca de senha valida senha atual, tamanho mínimo, confirmação e impede reutilizar a senha temporária; após sucesso grava hash, limpa a obrigatoriedade e registra `AuditLog`.
- Mapa de Funcionários passou a carregar uma listagem resumida paginada (`/api/employees?summary=true&limit=50`) e só busca dados completos/sensíveis no detalhe (`/api/employees/[id]`) quando o usuário clica em `Ver detalhes`.
- Correção do Mapa pós-otimização: a listagem volta a partir de `EmployeeProfile`, sem exigir `User`, escala, supervisor ou status literal perfeito. O endpoint retorna `data`, `total`, `page`, `limit` e `totalPages`, e filtros vazios usam `Todos` para não esconder colaboradores reais.
- O filtro de status do Mapa aceita variações como `Ativo`, `ACTIVE`, `Aprovado`, `Pendente`, `Inativo` e similares. Admin pode usar `Todos` para auditar todos os perfis existentes conforme permissão.
- Layout geral compactado para zoom 100% em notebooks/desktops: sidebar/header menores, cards e tabelas com padding reduzido, filtros responsivos e tabelas com rolagem horizontal interna quando necessário.
- Escalas usa consultas mais leves por período/mês selecionado, limitadas por página, com `select` nos campos necessários e apenas a última ocorrência de presença por célula para montar a grade.
- Aprovar/recusar solicitações mantém atualização local no frontend e agora faz guarda transacional por status atual antes de histórico/notificações/aplicação de escala, reduzindo clique duplo e logs duplicados.
- Foram adicionados índices de performance para filtros de colaboradores, escalas, solicitações, notificações, auditoria e attendance. A migration é `202605171245_performance_indexes`.

### Horas Operacionais

- O módulo `/horas-operacionais` permite comparar escala planejada com horas realizadas importadas por Excel ou lançadas manualmente pela célula da escala.
- O template fica em `/api/work-hours/template` e usa `wb_login + data` como chave operacional. Colunas obrigatórias: `wb_login`, `data`, `entrada_real`, `saida_real` e `horas_realizadas`.
- O preview valida linha a linha: WB/Login obrigatório e existente, data válida, horários válidos, horas válidas, duplicidade no arquivo e atualização de registro já existente.
- WB/Login inexistente bloqueia a linha. Registro sem escala vinculada vira alerta (`Sem escala`) e pode ser importado por WFM/Admin mediante confirmação.
- WFM/Admin/Gestão fazem upload, aprovam/recusam ajustes e exportam CSV. Supervisor visualiza registros e solicita ajuste, mas não altera a hora oficial diretamente.
- Na tela Escalas, WFM/Admin podem clicar no dia do colaborador, abrir a seção `Horas`, lançar ou corrigir entrada real, saída real, horas realizadas e observação. O sistema cria/atualiza `WorkHourRecord` com `source = MANUAL`, recalcula diferença/status, grava histórico e AuditLog.
- Se já existir hora importada para o mesmo colaborador/data, a sobrescrita manual exige confirmação. Supervisor vê as horas no mesmo modal e usa apenas `Solicitar ajuste de horas`.
- Quando Supervisor solicita ajuste, o `WorkHourRecord` fica como `Ajuste solicitado` e uma pendência é criada para WFM/Admin.
- Ao aprovar, WFM/Admin atualiza as horas ajustadas e efetivas, recalcula diferença e grava histórico/AuditLog. Ao recusar, as horas originais permanecem.
- Minha Escala mostra as horas importadas no calendário diário e troca o card de Resumo de Horas por dados reais do período quando houver `WorkHourRecord`.
- A listagem e a exportação CSV de horas respeitam filtros aplicados, incluindo origem (`MANUAL` ou `upload-horas`), e saem em `/api/work-hours/export`.
- A migration do módulo é `202605171330_work_hours_module`. Em ambiente online, aplicar com `npx prisma migrate deploy`; localmente, usar `npx prisma migrate dev`.

Limitações temporárias:

- As permissões configuráveis em `SystemConfig` já são persistidas e visíveis, mas parte dos módulos antigos ainda usa checagens por role enquanto a migração fina para permissões granulares é concluída.
- Se um supervisor ainda não tiver colaboradores vinculados por `supervisorId`, o Mapa pode exibir a visão operacional ampla temporária, sempre sem dados sensíveis.
- Regras de tokens ficam salvas para fase futura; o motor automático de concessão de tokens ainda não é executado.
- Regras de cobertura ficam disponíveis para parametrização e leitura operacional, com cálculo avançado de gap por regra preparado para evolução do Staff/Cobertura.
- Horas Operacionais ainda mantém ajustes em painel próprio, sem integrar o tipo `Ajuste de Horas` à esteira geral para não mexer no fluxo de folgas já validado.
- Integração de cards de horas na Central Operacional ficou preparada pelo serviço/dados reais, mas a exibição principal desta etapa está no painel de Horas e em Minha Escala.

## Estrutura

```text
src/app
  api/                         API routes
  (app)/                       Rotas autenticadas
  cadastro-colaborador/        Cadastro público
  login/                       Login
src/components
  layout/                      Sidebar/header
  ui/                          Primitivos visuais
  modules.tsx                  Telas principais
src/lib
  auth-options.ts              Sessão e login
  supabase-auth.ts             Verificação Supabase Auth desligada no modo local
  supabase-storage.ts          Buckets, validações e storage local
  permissions.ts               RBAC/LGPD
  mock-db.ts                   Demo server-side em memória
  prisma.ts                    Prisma client
prisma
  schema.prisma                Modelagem relacional
  migrations/                  Migrations SQL
  seed.ts                      Seed demo protegido
  seed-prod.ts                 Seed mínimo para piloto real
  clear-demo.ts                Limpeza de massa fake mantendo estrutura
docs
  deploy.md
  env.md
  supabase.md
  vercel.md
  costs.md
```

## Checklist Antes De Produção

- `npm install` executado sem erro.
- `npm run db:up` executado com Docker ativo.
- `npm run build` sem erro.
- `DATABASE_URL` e `DIRECT_URL` apontando para Postgres local no modo local.
- `NEXTAUTH_SECRET` forte.
- `NEXTAUTH_URL` com `http://localhost:3000`.
- `npx prisma migrate dev` executado.
- `npx prisma db seed` executado.
- Seed demo bloqueado em produção real.
- Login funcionando.
- Permissões funcionando.
- Colaborador não vê dados de outro colaborador.
- Supervisor só vê próprio time.
- RH/Admin/WFM aprovam cadastros.
- Dados sensíveis protegidos.
- Upload Excel funcionando.
- Ausência/presença atualiza cobertura.
- Solicitação muda de status.
- Aprovação de folga atualiza escala.
- Report de turno salva e exporta.
- Mural e aniversariantes aparecem.
- Notificações internas funcionam.
- Auditoria registra ações.
- Storage privado validando permissão.
- Link Vercel ou domínio próprio funcionando.

## Custos

Consulte `docs/costs.md`.

Resumo estimado inicial:

- Supabase Pro: US$ 25/mês, aproximadamente R$ 130 a R$ 160/mês.
- Vercel Pro: US$ 20/mês por seat, aproximadamente R$ 100 a R$ 130/mês.
- Domínio `.com.br`: aproximadamente R$ 40/ano.
- E-mail transacional: R$ 0 nesta versão.
- Monitoramento externo: R$ 0 nesta versão.

Budget recomendado com margem: R$ 500/mês.
