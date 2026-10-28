# Migração do legado para V2

## Estratégia

1. congelar a implementação anterior para auditoria;
2. desenvolver V2 em branch isolada;
3. publicar backend V2 sem desligar V1;
4. gerar códigos de enrollment para máquinas piloto;
5. instalar V2 em uma máquina e remover legado nela;
6. comparar presença e duração por um dia;
7. expandir para 5, depois 20 máquinas;
8. migrar por lotes;
9. revogar token global antigo;
10. desligar endpoints V1 somente após 100% da frota migrada.

## Dados

Os registros V1 permanecem preservados. Não haverá conversão retroativa de `Microsoft Edge` ou `Google Chrome` sem domínio.
A V2 começa a registrar segmentos novos em tabelas próprias. A interface pode unir os dois conjuntos durante a transição.

## Rollback

Cada máquina mantém instalador anterior apenas durante o piloto. Em caso de falha, a V2 é removida e o V1 pode ser reinstalado.
O backend V2 é aditivo e não altera endpoints V1 até o corte final.
