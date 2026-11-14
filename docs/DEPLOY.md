# Deploy da CrashMap API (Neon + Render)

Guia de implantação em planos gratuitos:

- **Banco:** PostgreSQL no [Neon](https://neon.com). Hiberna após alguns
  minutos sem uso e acorda sozinho na próxima consulta; não expira.
- **API:** Web Service no [Render](https://render.com), descrito no
  `render.yaml` da raiz do repositório.
- **Sincronização PRF:** GitHub Actions (`.github/workflows/prf-sync.yml`),
  gravando direto no Neon. Ver `docs/PRF_SYNC.md`.

Os limites dos planos gratuitos mudam com frequência; confira na página de
preços de cada provedor antes de criar as contas.

## Comportamento esperado no plano gratuito

- A API hiberna após cerca de 15 minutos sem requisições. A primeira
  requisição depois disso pode levar perto de 1 minuto. Antes de uma
  apresentação, abra `https://<serviço>.onrender.com/health` alguns minutos
  antes.
- O Render não oferece "pre-deploy command" no plano gratuito; por isso
  `prisma migrate deploy` roda no fim do build. Se uma migration falhar, o
  deploy falha e a versão anterior continua no ar.

---

## Passo 1 — Banco no Neon

1. Crie a conta (pode entrar com o GitHub).
2. Crie um projeto (`crashmap`) na região **AWS US East 1 (N. Virginia)**, a
   mesma região do Render configurada no `render.yaml`, para reduzir a latência
   entre API e banco.
3. Em "Connect", desative **Connection pooling** e copie a string de conexão
   **direta**. Ela termina com `?sslmode=require`. As migrations do Prisma
   precisam da conexão direta.
4. Guarde essa string: ela é a `DATABASE_URL` dos passos 2 e 4. Não a coloque
   em arquivos do repositório.

## Passo 2 — API no Render

1. Crie a conta (pode entrar com o GitHub) e autorize o acesso ao repositório
   `crashmap-api`.
2. **New → Blueprint**, escolha o repositório. O Render lê o `render.yaml` e
   pede os valores marcados como `sync: false`:

| Variável | Valor |
|---|---|
| `DATABASE_URL` | string direta do Neon (passo 1) |
| `TRUST_PROXY` | deixe vazio no primeiro deploy (passo 6) |
| `ADMIN_PANEL_URL` | endereço público do Farol Admin; vazio por enquanto |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | conta Gmail e senha de app (as mesmas do `.env` local) |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | credenciais do Cloudinary |

   `ACCESS_TOKEN_SECRET` e `REFRESH_TOKEN_SECRET` são gerados pelo próprio
   Render (`generateValue`). `NODE_ENV` já vem como `production`.
3. Confirme. O primeiro build instala dependências, gera o cliente Prisma,
   compila e aplica todas as migrations no Neon.

## Passo 3 — Verificação da API

```bash
curl https://<serviço>.onrender.com/health
```

Esperado: `{"data":{"status":"ok",...,"database":"up"}}`.

## Passo 4 — Sincronização PRF no GitHub

1. No GitHub: **Settings → Secrets and variables → Actions → New repository
   secret** → `DATABASE_URL` com a mesma string do Neon.
2. (Opcional) Em **Variables**, `PRF_SYNC_YEARS` para fixar os anos, por
   exemplo `2022-2026`. Sem ela, entram o ano corrente e os anos já
   importados.
3. **Actions → Sync PRF accidents → Run workflow**, primeiro com `dry_run`
   marcado para conferir as contagens e depois sem ele.
4. A partir daí o workflow roda todo dia às 06:17 (Brasília).

## Passo 5 — Clientes

Atualize a URL base da API no Farol e no Farol Admin para
`https://<serviço>.onrender.com`. Essa mudança fica nos repositórios dos
clientes.

## Passo 6 — IP real do cliente (`TRUST_PROXY`)

A API usa o IP do cliente nos limites de tentativas (login, cadastro, senha) e
na auditoria. No Render, a requisição chega por um balanceador que **acrescenta**
o IP ao cabeçalho `X-Forwarded-For` sem limpar o que o cliente enviou, então
`TRUST_PROXY=true` permitiria falsificar o IP. O número correto de proxies não
está na documentação do Render e precisa ser medido:

1. Com `TRUST_PROXY` vazio, faça uma requisição e veja no log do Render
   (`remoteAddress`) qual IP aparece. Será o do balanceador, igual para todos
   os clientes.
2. Teste `TRUST_PROXY=1` e compare o `remoteAddress` com o seu IP público. Se
   aparecer um IP de borda (Cloudflare) em vez do seu, teste `2`.
3. Fique com o menor número que mostra o seu IP real.

Enquanto isso não for ajustado, todos os clientes compartilham o mesmo limite
de tentativas.

## Atualizações

Todo push na branch `development` dispara um novo deploy, e as migrations
novas são aplicadas no build. Para aplicar uma migration manualmente:

```bash
DATABASE_URL="<string do Neon>" pnpm prisma migrate deploy
```
