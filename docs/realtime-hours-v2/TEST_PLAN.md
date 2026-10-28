# Plano de testes

## Automatizados

- normalização de domínio e descarte de URL completa;
- frescor do estado do navegador;
- troca de contexto e duração de segmentos;
- Native Messaging length-prefixed;
- HMAC e canonical request;
- fila local, quarentena e idempotência;
- contrato Zod de enrollment, heartbeat e activity;
- autorização de Supervisor e perfis gerenciais;
- build Windows amd64;
- scanner de segredos.

## Windows em máquina piloto

1. instalação limpa;
2. upgrade a partir de 0.3.x e 0.6.x;
3. apenas uma tarefa e um processo;
4. Chrome: youtube.com -> chatgpt.com;
5. Edge: outlook.office.com -> google.com;
6. alternância Chrome/Edge;
7. janela anônima;
8. bloqueio e desbloqueio;
9. cinco minutos ocioso e retorno;
10. internet desligada por 15 minutos e recuperação;
11. reinício do Windows;
12. reparo e desinstalação;
13. revogação do dispositivo;
14. validação de que nenhuma URL completa chegou ao banco.

## Critério de aceite

- zero erros de autenticação;
- zero registros duplicados;
- domínio correto em 100% das trocas controladas;
- diferença de duração inferior a 5 segundos nos cenários controlados;
- fila esvaziada após reconexão;
- crescimento do banco dentro do orçamento definido;
- nenhum segredo em binário, log, ZIP ou repositório.
