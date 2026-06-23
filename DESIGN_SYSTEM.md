# Design System Atual - Central Operacional

Data: 2026-06-19  
Fonte do inventario: `tailwind.config.ts`, `src/app/globals.css`, `src/components/ui/primitives.tsx`, `src/components/layout/app-shell.tsx`, `src/components/realtime-page.tsx`, `src/components/financeiro-page.tsx` e telas operacionais recentes.

## Objetivo

Este arquivo documenta a identidade visual atual do sistema para servir como base de evolucao/rebranding. Ele descreve cores, tipografia, layout, componentes, padroes de uso e pontos de melhoria.

O sistema hoje segue uma direcao de dashboard operacional premium: fundo claro, cards brancos, azul como cor primaria, sidebar escura, indicadores compactos, tabelas densas e filtros funcionais.

## Personalidade Visual

- Operacional e executivo.
- Limpo, claro e orientado a dados.
- Premium sem ser decorativo demais.
- Interface de trabalho diario, nao landing page.
- Alta densidade de informacao, mas com cards e filtros organizados.

Palavras-chave:

- SaaS interno
- Command center
- Operacao em tempo real
- Financeiro/controle
- Gestao de pessoas
- WFM/BPO

## Tokens De Cor

### Tokens Tailwind

Definidos em `tailwind.config.ts`.

| Token | Valor | Uso |
| --- | --- | --- |
| `navy.50` | `#EAF1FF` | fundos azuis muito suaves |
| `navy.100` | `#D5E3FF` | bordas/fundos suaves |
| `navy.500` | `#2563EB` | azul primario |
| `navy.700` | `#1D4ED8` | azul primario hover/gradiente |
| `navy.900` | `#071B3A` | sidebar e textos escuros |
| `navy.950` | `#04142E` | texto forte |
| `surface` | `#F6F8FC` | background base |
| `ink` | `#18233A` | texto principal |
| `muted` | `#5D6C88` | texto secundario |
| `border` | `#DFE4EC` | bordas padrao |
| `success` | `#10B981` | sucesso/positivo |
| `warning` | `#F59E0B` | alerta/atencao |
| `danger` | `#EF4444` | erro/risco |
| `accent` | `#7C3AED` | roxo de apoio |

### Variaveis CSS

Definidas em `src/app/globals.css`.

```css
:root {
  --navy: #071b3a;
  --navy-2: #0b1f44;
  --blue: #2563eb;
  --surface: #f6f8fc;
  --ink: #18233a;
  --muted: #5d6c88;
  --border: #dfe4ec;
  --border-strong: #cfd8e7;
  --card-shadow: 0 16px 36px rgba(7, 27, 58, 0.065);
  --card-shadow-hover: 0 22px 48px rgba(7, 27, 58, 0.1);
}
```

### Cores Semanticas

| Semantica | Cor principal | Fundo suave | Texto |
| --- | --- | --- | --- |
| Primario | `#2563EB` | `#EFF6FF` / `#EAF1FF` | `#1D4ED8` |
| Sucesso | `#10B981` | `#ECFDF5` | `#047857` |
| Alerta | `#F59E0B` | `#FFFBEB` | `#B45309` |
| Erro/Risco | `#EF4444` | `#FEF2F2` | `#B91C1C` |
| Neutro | `#64748B` | `#F1F5F9` | `#334155` |
| Apoio/Roxo | `#7C3AED` | `#F5F3FF` | `#6D28D9` |

## Tema Claro

Background principal:

- `#F6F8FC`
- Gradiente global com luz azul no topo:

```css
background:
  radial-gradient(circle at 78% -12%, rgba(37, 99, 235, 0.1), transparent 34rem),
  linear-gradient(180deg, #fbfcff 0%, #f6f8fc 34%, #f3f6fb 100%),
  var(--surface);
```

Cards:

- Fundo: branco ou `rgba(255,255,255,.98)`
- Borda: `#DFE4EC`
- Sombra: suave e fria
- Raio: 12px no padrao antigo, 18px-24px nas telas novas.

## Tema Escuro

Existe suporte por classe `.dark`, salvo em `central-operacional-theme`.

Tokens escuros:

| Token | Valor |
| --- | --- |
| `--surface` | `#08111f` |
| `--ink` | `#e5edf8` |
| `--muted` | `#9aa8bd` |
| `--border` | `rgba(148, 163, 184, 0.24)` |
| `--blue` | `#60a5fa` |

Observacao: o tema escuro existe, mas muitas telas ainda usam classes utilitarias claras. O CSS global compensa parte disso com seletores `.dark [class*="bg-white"]`, mas uma evolucao ideal deveria migrar para tokens semanticos.

## Tipografia

Fonte principal:

```css
font-family: Inter, Aptos, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
```

Fallback Tailwind:

```ts
fontFamily: {
  sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
}
```

Escala usada hoje:

| Elemento | Tamanho comum | Peso |
| --- | --- | --- |
| H1 pagina | 20px-22px | `font-extrabold` / `font-black` |
| H2 card | 14px-18px | `font-black` |
| KPI principal | 21px-36px | `font-black` |
| Label | 10px-12px uppercase | `font-extrabold` / `font-black` |
| Texto comum | 13px-14px | `font-medium` / `font-bold` |
| Texto auxiliar | 11px-12.5px | `font-medium` / `font-semibold` |

Diretriz:

- Usar `font-black` apenas em titulos, KPIs e labels operacionais.
- Evitar tudo em bold quando a tela ja tem muitos dados.
- Manter `letter-spacing: 0` em textos comuns.
- Usar uppercase apenas em labels curtos.

## Layout Base

### Shell

Arquivo principal: `src/components/layout/app-shell.tsx`.

Desktop:

- Sidebar fixa/sticky esquerda.
- Largura expandida: `224px`.
- Largura recolhida: `72px`.
- Header sticky com altura `64px`.
- Conteudo principal com `min-w-0` e background `surface`.

Mobile:

- Sidebar vira drawer lateral.
- Largura: `284px`, max `86vw`.
- Overlay escuro com blur leve.

### Sidebar

Estilo:

- Fundo `navy-gradient`.
- Item ativo com gradiente azul `from-blue-600 to-blue-500`.
- Indicador lateral azul claro.
- Icones Lucide.
- Tooltips quando recolhida.

Tokens visuais:

- Texto: branco/azul claro.
- Hover: `hover:bg-white/9`.
- Ativo: sombra escura + ring branca sutil.

### Header

Estilo:

- Sticky top.
- Fundo branco translúcido `bg-white/94`.
- Borda inferior `border-border/80`.
- Blur `backdrop-blur-xl`.
- Busca global com `premium-control`.
- Notificacoes em popover.
- Toggle de tema.

## Espacamento E Grid

Padroes atuais:

- Gap entre secoes: `space-y-4` ou `gap-4`.
- Cards pequenos: padding `p-3`.
- Cards medios: padding `p-4`.
- Cards premium recentes: padding `p-4` a `p-5`.
- Grids de KPI: `md:grid-cols-2`, `xl:grid-cols-5`.
- Grids operacionais densos: `xl:grid-cols-*`, `2xl:grid-cols-*`.

Diretriz para novas telas:

- Usar uma grid principal consistente por pagina.
- Preferir `grid gap-4`.
- Evitar varias grids independentes com larguras diferentes.
- Evitar `max-h` com scroll interno em tabelas principais quando a pagina pode rolar.
- Manter `overflow-x-auto` em tabelas largas.

## Componentes Base

### `.card`

Definido em `globals.css`.

Uso:

- Container padrao de painel.
- Borda, fundo branco, sombra suave.

```css
.card {
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.98);
  box-shadow: var(--card-shadow);
}
```

### `.premium-control`

Uso:

- Inputs.
- Selects.
- Botoes secundarios.
- Caixas de busca.

Visual:

- Altura comum: 36px-48px conforme contexto.
- Raio: 10px.
- Fundo branco.
- Borda sutil.
- Sombra baixa.

### `.premium-button`

Uso:

- Acoes primarias.
- Importar, salvar, atualizar, exportar quando principal.

Visual:

- Gradiente azul vertical.
- Texto branco.
- Sombra azul suave.
- Raio: 10px.

### `PageHeader`

Arquivo: `src/components/ui/primitives.tsx`.

Padrao:

- Icone em quadrado 36px.
- Titulo 20px-22px.
- Descricao 12.5px.
- Borda inferior sutil.
- Acoes a direita.

### `StatCard`

Arquivo: `src/components/ui/primitives.tsx`.

Padrao:

- Card pequeno com icone circular/quadrado.
- Titulo curto.
- Valor grande.
- Helper/change abaixo.
- Tones: blue, green, orange, red, purple, gold, cyan.

### `Panel`

Arquivo: `src/components/ui/primitives.tsx`.

Padrao:

- Card com header em gradiente `from-white to-slate-50`.
- Titulo 14px.
- Acao opcional com seta.
- Conteudo em `p-3`.

### Badges

`StatusBadge` usa mapeamento por texto:

- Critico/recusado/inoperante: vermelho.
- Atencao/manutencao/pendente: amarelo.
- Aprovado/online/lido/sucesso: verde.
- Nesting: roxo.
- Informativo/analise: azul.
- Fallback: cinza.

Diretriz:

- Badges devem ser compactos.
- Usar fundo suave + texto forte.
- Evitar badges grandes em tabelas densas.

## Tabelas

Padrao atual:

- Container com `overflow-x-auto`.
- Header em slate claro.
- Texto uppercase pequeno.
- Linhas com hover azul suave.
- Alternancia leve em tabelas novas.
- Valores numericos em `font-black` ou `font-bold`.
- Acoes em botoes compactos.

Telas recentes:

- Real Time usa tabelas mais modernas com colunas clicaveis, `SortIndicator`, badges e metric cells.
- Filas/Agentes evitam scroll vertical interno, mantendo scroll da pagina.

Diretrizes:

- Header sticky quando a tabela tiver muitas linhas.
- Nunca usar scroll vertical duplo se a tabela for o conteudo principal.
- Usar `min-w-*` e `overflow-x-auto` para tabelas muito largas.
- Numeros devem alinhar visualmente.
- Colunas tecnicas podem ir para detalhe/drawer, nao para a primeira dobra.

## Filtros

Padrao atual:

- Filtros em card ou faixa arredondada.
- Inputs/selects com `.premium-control`.
- Busca como primeiro campo.
- Botoes "Filtros padrao" e "Limpar".
- Em Real Time, filtros de LOB viraram chips/botoes com contagem.

Diretriz:

- Para filtros de alta frequencia, preferir chips/botoes.
- Para listas longas, usar select/dropdown.
- Para datas/ciclos, usar picker visual.
- Filtros devem recalcular cards e tabela com a mesma base.

## Graficos

Biblioteca:

- Recharts.

Uso atual:

- Sparklines em Real Time.
- AreaChart sem eixos visiveis.
- Tooltip customizado.
- Gradiente suave abaixo da linha.
- ReferenceLine tracejada para metas em graficos de latencia.

Diretrizes:

- Graficos pequenos devem contar uma historia simples.
- Sem eixos em cards pequenos.
- Tooltip deve mostrar ciclo/data, valor e variacao.
- Para metas, usar linha tracejada e selo pequeno no card.
- Nao usar grafico se a informacao for melhor como numero/tabela.

## Real Time - Direcao Visual Mais Nova

Arquivo: `src/components/realtime-page.tsx`.

Essa tela representa a direcao visual mais recente do sistema.

Padroes:

- Cards grandes arredondados `rounded-[22px]` a `rounded-[24px]`.
- Sombra bem leve `0_8px_24px_rgba(15,23,42,0.04)`.
- KPI com valor forte e sparkline.
- Chips de filtro por LOB.
- Tabelas com metric cells e deltas.
- Drawer de detalhe com cards de resumo.

Elementos importantes:

- `KpiCard`
- `QueueLobCard`
- `MiniMetricChartCard`
- `TrendSparkline`
- `TrendBadge`
- `AgentLobQuickFilter`
- `QueueLobQuickFilter`

Esta tela deve ser usada como referencia para proximas melhorias visuais.

## Financeiro - Direcao Visual Financeira

Arquivo: `src/components/financeiro-page.tsx`.

Padroes:

- Acesso restrito indicado visualmente.
- Cards financeiros no topo.
- Filtros por ciclo/cost center.
- Acoes claras: historico, ajustes, template, upload, exportacao.
- Penalty tratado como percentual.

Diretriz:

- Manter visual mais sobrio e confiavel.
- Evitar cores demais em valores financeiros.
- Usar vermelho/verde apenas para variacao ou impacto.

## Meu Perfil - Direcao Operacional Pessoal

Arquivo: `src/components/employee-profile-page.tsx`.

Padroes:

- Header com avatar/iniciais.
- Cards em grid.
- Indicadores de cronograma, horas, performance, invoice, solicitacoes.
- Necessita cuidado com grids para evitar buracos visuais.

Diretriz:

- Usar grid unico quando possivel.
- Cards inferiores devem ocupar toda a largura util.
- Evitar cards muito altos com pouco conteudo.

## Iconografia

Biblioteca:

- `lucide-react`.

Padroes:

- Icones de 14px-20px.
- Icones em botao ou bolha suave.
- Sidebar usa icones pequenos.
- KPIs usam icones em quadrado arredondado.

Diretriz:

- Usar Lucide sempre que existir icone equivalente.
- Evitar SVG manual para icones.
- Icones devem reforcar acao/estado, nao decorar por decorar.

## Radius E Sombras

Tokens:

- Tailwind `xl`: 14px.
- Tailwind `2xl`: 18px.
- `.card`: 12px.
- Real Time premium: 18px-24px.
- Pills: 999px.

Sombras:

- `shadow-soft`: `0 8px 18px rgba(7,27,58,.045)`.
- `shadow-card`: `0 16px 36px rgba(7,27,58,.075)`.
- Popover: `0 24px 60px rgba(7,27,58,.18)`.

Diretriz:

- Cards comuns: 12px-18px.
- Cards executivos/Real Time: 22px-24px.
- Inputs/botoes: 10px.
- Evitar sombra pesada em telas densas.

## Estados Visuais

### Loading

Padrao:

- Skeletons simples com `animate-pulse`.
- EmptyState quando nao ha dados.

### Empty

Padrao:

- Icone central.
- Titulo curto.
- Descricao objetiva.

### Erro

Padrao:

- Fundo vermelho suave.
- Texto vermelho forte.
- Mensagem clara.

### Sucesso

Padrao:

- Fundo verde suave.
- Texto verde forte.
- Toast/mensagem compacta.

## Acessibilidade E UX

Ja existe:

- `focus-visible` global com outline azul.
- Botoes com `aria-label` em sidebar/menu.
- Mobile drawer com `role="dialog"` e `aria-modal`.
- Escape fecha sidebar mobile.

Melhorias recomendadas:

- Garantir `aria-label` em todos os botoes icon-only.
- Evitar informacao apenas por cor.
- Badges devem ter texto.
- Tabelas muito largas precisam manter cabecalho legivel.
- Tooltips devem ser complementares, nao obrigatorios.

## Problemas Visuais Recorrentes

1. Mistura de dois sistemas visuais:
   - Antigo: `.card`, radius 12, paineis densos.
   - Novo: cards premium 22-24, sparklines, chips, sombras suaves.

2. Muitos estilos inline via Tailwind:
   - Gradientes, sombras e raios repetidos diretamente nos componentes.
   - Dificulta rebranding global.

3. Arquivo `modules.tsx` concentra muitas telas:
   - Dificulta padronizacao de componentes.
   - Aumenta risco de estilos divergentes.

4. Dark mode compensatorio:
   - O tema escuro depende de seletores globais amplos.
   - Ideal migrar para tokens semanticamente aplicados.

5. Tabelas largas:
   - Algumas telas ainda podem ter scroll interno desnecessario.
   - Preferir pagina rolando + horizontal somente quando necessario.

## Recomendacoes Para Melhorar O Design

### Fase 1 - Tokens

Centralizar tokens em classes/componentes:

- `app-surface`
- `app-card`
- `app-card-premium`
- `app-control`
- `app-button-primary`
- `app-button-secondary`
- `app-table`
- `app-badge`

Objetivo: trocar visual globalmente sem editar dezenas de telas.

### Fase 2 - Componentes

Promover estes componentes para padrao oficial:

- `PageHeader`
- `StatCard`
- `Panel`
- `StatusBadge`
- `KpiCard`
- `MiniMetricChartCard`
- `TrendSparkline`
- `FilterBar`
- `DataTable`
- `Drawer`
- `Modal`

### Fase 3 - Layout

Definir grids por tipo de tela:

- Dashboard executivo: KPI row + cards 2/3 colunas + tabela.
- Operacional denso: filtros compactos + tabela full width.
- Perfil: grid unico 12 colunas.
- Financeiro: filtros + cards financeiros + tabela.
- Real Time: ciclo + KPIs + visao por entidade.

### Fase 4 - Rebranding

Sugestao de direcao:

- Manter azul como cor primaria.
- Clarear o fundo para `#F7F9FC`.
- Usar texto principal mais escuro `#0F172A`.
- Usar secundario `#64748B`.
- Reduzir gradientes decorativos fora da sidebar/login.
- Elevar padrao premium do Real Time para o restante do produto.

## Paleta Recomendada Para Proxima Iteracao

| Papel | Cor |
| --- | --- |
| Background | `#F7F9FC` |
| Card | `#FFFFFF` |
| Texto principal | `#0F172A` |
| Texto secundario | `#64748B` |
| Borda | `#E5EAF2` |
| Azul principal | `#2563EB` |
| Azul hover | `#1D4ED8` |
| Azul suave | `#EFF6FF` |
| Sucesso | `#10B981` |
| Alerta | `#F59E0B` |
| Erro | `#EF4444` |
| Roxo apoio | `#8B5CF6` |

## Do / Don't

### Fazer

- Usar cards brancos com borda sutil.
- Usar filtros compactos e alinhados.
- Usar chips para filtros de alta frequencia.
- Manter iconografia Lucide.
- Usar deltas compactos em KPIs.
- Usar sparklines apenas em KPIs de tendencia.
- Usar estados vazios amigaveis.
- Manter scroll vertical da pagina para tabelas principais.

### Evitar

- Criar cards dentro de cards sem necessidade.
- Usar scroll vertical duplo.
- Usar gradientes/orbs decorativos em dashboards operacionais.
- Colocar texto explicativo demais na primeira dobra.
- Misturar muitos tons de uma mesma cor.
- Usar badges grandes em tabelas densas.
- Usar `max-height` em tabelas principais se a pagina pode rolar.
- Criar novos estilos isolados sem token/componente.

## Arquivos Fonte Relevantes

- `tailwind.config.ts`: tokens Tailwind.
- `src/app/globals.css`: variaveis globais, tema claro/escuro, classes premium.
- `src/components/ui/primitives.tsx`: componentes base.
- `src/components/layout/app-shell.tsx`: sidebar, header, busca global, notificacoes.
- `src/components/realtime-page.tsx`: visual premium mais recente.
- `src/components/financeiro-page.tsx`: padrao financeiro/restrito.
- `src/components/employee-profile-page.tsx`: layout de perfil.
- `src/components/modules.tsx`: muitas telas legadas/consolidadas.

## Proximo Passo Sugerido

Antes de redesenhar telas inteiras, criar uma camada pequena de componentes oficiais:

1. `AppCard`
2. `AppButton`
3. `AppControl`
4. `AppTable`
5. `AppBadge`
6. `KpiCard`
7. `FilterChips`
8. `AppDrawer`

Depois, aplicar primeiro nas telas com maior impacto:

1. Real Time
2. Central Operacional
3. Mapa de Funcionarios
4. Meu Perfil
5. Billing / Financeiro

Assim o rebranding fica controlado, progressivo e sem quebrar regra de negocio.
