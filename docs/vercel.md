# Vercel

## Configuração

- Framework: Next.js
- Install command: `npm install`
- Build command: `npm run build`
- Output: padrão Next.js
- Production branch: `main`
- Preview deploys: habilitados

## Deploy

1. Suba o código no GitHub.
2. Importe o repositório na Vercel.
3. Configure variáveis em `Production`, `Preview` e `Development`.
4. Faça deploy.
5. Teste o link `.vercel.app`.

## Domínio

Adicione o domínio em `Settings > Domains` e siga as instruções DNS.

Para Registro.br:

- domínio raiz: configure os registros recomendados pela Vercel.
- subdomínio: crie CNAME para `cname.vercel-dns.com`.

Atualize `NEXTAUTH_URL` para o domínio final.
