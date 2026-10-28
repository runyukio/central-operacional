# Segurança e privacidade

## Dados permitidos

- hostname;
- usuário Windows / WB;
- estado de sessão;
- tempo ocioso;
- nome do processo ativo;
- hostname do domínio ativo;
- início, fim e duração;
- versão do agente e extensão.

## Dados proibidos

- URL completa;
- caminho, query string ou fragmento;
- título de página, e-mail ou documento;
- conteúdo da página;
- texto digitado, teclado, senha ou clipboard;
- screenshot, áudio ou vídeo;
- histórico anterior à instalação.

## Credenciais

- pacote sem segredo de produção;
- enrollment code temporário e revogável;
- segredo individual por dispositivo;
- segredo protegido por DPAPI LocalMachine;
- assinatura HMAC com timestamp, nonce e hash do corpo;
- revogação por device ID.

## Resposta necessária imediata

Qualquer token já publicado em chat, README, ZIP ou repositório deve ser rotacionado. A versão V2 não reutiliza esse token.
