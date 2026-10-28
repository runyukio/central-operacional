# Rebuild Realtime Hours V2

Esta pasta é a fonte de verdade da reconstrução do monitoramento de presença, aplicativos e domínios.
A versão legada foi congelada em uma branch de arquivo e não será usada como base direta para o novo agente.

## Objetivo

Entregar um sistema corporativo que:

- funcione silenciosamente após comunicação formal aos colaboradores;
- capture presença, inatividade, bloqueio, aplicativo em primeiro plano e domínio da aba ativa;
- suporte Chrome e Edge por extensão gerenciada;
- nunca armazene URL completa, conteúdo, texto digitado, senha, screenshot ou clipboard;
- não dependa de PowerShell durante a operação diária;
- não use token global embutido em instalador;
- mantenha custo previsível no Supabase;
- tenha diagnóstico, rollback, testes automatizados e rollout gradual.

## Situação

A base foi criada a partir da `main` atual. A implementação anterior foi preservada apenas para auditoria e comparação.
A nova implementação começa em `agent/realtime-hours-v2`.

## Gates de publicação

Nenhum código será enviado a produção antes de cumprir todos os gates:

1. testes unitários do agente;
2. build Windows reproduzível;
3. validação de segredo e varredura de credenciais;
4. testes do contrato backend;
5. testes de instalação, reparo, upgrade e desinstalação;
6. teste real Chrome e Edge;
7. teste offline e reenvio;
8. teste de usuário bloqueado/ocioso;
9. validação de retenção e crescimento do banco;
10. piloto de uma máquina sem erros por um dia útil.
