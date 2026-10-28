# Browser extension v2

A extensão lê a URL apenas em memória e transmite somente o hostname normalizado.

Exemplo:

```text
https://www.youtube.com/watch?v=abc -> youtube.com
```

Ela não envia caminho, query string, fragmento, título da página, conteúdo, texto digitado,
senhas, clipboard, screenshots ou histórico anterior.

## Compatibilidade

- Google Chrome
- Microsoft Edge
- Brave, quando a política corporativa permitir

## Instalação corporativa

A extensão deve ser empacotada com chave estável, publicada em endpoint HTTPS e instalada
por política gerenciada. O instalador não deve embutir credenciais de produção.
