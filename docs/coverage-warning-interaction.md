# Interação do alerta de impacto operacional

## Diagnóstico

O formulário de detalhe da Esteira usa Radix Dialog. O alerta de impacto era
uma `div` comum, fora do portal e da pilha de interação/foco do Radix.
Ao abrir o formulário, o DismissableLayer do Radix aplica
`document.body.style.pointerEvents = "none"`. O alerta herdava esse valor,
apesar de estar visualmente acima do formulário com `z-index: 70`.

Reprodução em Chromium com os componentes reais e respostas HTTP simuladas:

- `body` e botão Voltar: `pointer-events: none`;
- camada do alerta: `z-index: 70`;
- `document.elementFromPoint()` no centro de Voltar: `textarea` do formulário
  de detalhe, abaixo do alerta;
- clique real em Voltar expirava sem atingir o botão;
- o alerta também estava fora do foco e da árvore acessível do modal Radix.

Não havia `inert`, carregamento ou botão inicialmente desabilitado causando
o problema. O bloqueio era o DismissableLayer ativo do formulário anterior,
não uma camada visual com z-index maior.

## Correção

O alerta agora usa Root, Portal, Overlay e Content do mesmo Radix Dialog.
O z-index continua em 70. Radix coordena os eventos, a acessibilidade, o foco
e a restauração do bloqueio externo quando cada modal fecha. O formulário
anterior permanece montado para preservar seus campos e estado.

Apenas a confirmação é desabilitada durante a aprovação. Uma trava síncrona
impede envios repetidos antes da atualização visual. Erros são apresentados
no alerta e liberam uma nova tentativa. Os dois chamadores fecham o alerta
somente depois de uma aprovação bem-sucedida e continuam usando seus fluxos
existentes de atualização do cronograma e dos indicadores.

O alerta anterior não fechava por Escape ou clique externo; isso foi
preservado. O foco inicial fica em Voltar e retorna ao controle que abriu o
alerta. A altura rolável permite alcançar os botões em telas pequenas.
As regras, cálculos, dados e estilos de conteúdo existentes foram mantidos.

## Validação reproduzível

```sh
npm ci
npx playwright install chromium
npm run test:coverage-warning
npm run typecheck
npm run build
```

Os testes usam as páginas reais Esteiras e Meu Cronograma, o conteúdo real
do formulário e do alerta, Radix e o CSS compilado do projeto. Apenas as
respostas de API e as ações globais do cabeçalho são substituídas. Não há
gravação no banco nem aprovação de solicitações reais.

| Cenário solicitado | Verificação |
| --- | --- |
| Voltar | Fecha só o alerta; mantém campos, detalhe e foco; não grava. |
| Aprovar mesmo assim | Envia confirmação com os dados preenchidos; fecha e exibe sucesso. |
| Duplo clique | Uma única requisição de confirmação e uma única gravação simulada. |
| Teclado | Foco inicial, Tab e Shift+Tab circulares, Espaço e Enter. |
| Toque | Caixas, Voltar e aprovação em viewport móvel de 375 × 667. |
| Sobre o formulário | Content superior recebe o clique mesmo com o detalhe Radix aberto. |
| Falha da API | HTTP 503 mantém alerta, mostra erro e permite repetir com sucesso. |
| Sem impacto | Aprovação normal em uma única requisição, sem alerta. |
| Reabertura | Reabre após Voltar; fechamento do detalhe remove o bloqueio do body. |
| Sem atravessar cliques | Caixas e backdrop não acionam o formulário inferior. |

Também se verifica a recarga dos indicadores na Esteira e do cronograma e
das horas no Meu Cronograma. A persistência e os cálculos do servidor não
são alterados por esta correção; a execução dos testes de navegador usa API
simulada para verificar o contrato e a interação sem atingir dados reais.

Validação em 06/11/2026: instalação limpa com `npm ci`, 8 testes de
navegador aprovados (incluindo os subcenários da tabela), 124 testes
existentes de solicitações/cobertura aprovados, TypeScript e ESLint sem
erros, build de produção concluído. As capturas desktop e móvel também
foram inspecionadas.
