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

## Passo 2b — E-mail pela API do Brevo

Desde setembro de 2025, o plano gratuito do Render bloqueia conexões de saída
nas portas SMTP (25, 465 e 587), então o envio pelo Gmail (porta 465) não
funciona. Isso afeta a verificação de conta, a recuperação de senha e os
convites de moderador. Quando `BREVO_API_KEY` está definida, a API envia pela
API HTTP do Brevo (`POST https://api.brevo.com/v3/smtp/email`, porta 443);
sem ela, continua usando o SMTP (útil localmente).

1. Crie a conta no [Brevo](https://www.brevo.com). O plano gratuito é
   relatado com limite de 300 e-mails/dia; confira na página de preços.
2. Em **Senders**, cadastre e verifique o endereço remetente (o mesmo de
   `SMTP_FROM`; pode ser um Gmail).
3. Em **SMTP & API → API keys**, gere uma chave.
4. No Render, em **Environment**, crie `BREVO_API_KEY` com a chave e confira
   `SMTP_FROM` (formato `email@x.com` ou `Nome <email@x.com>`).

Remetentes de e-mail gratuito (Gmail) sem domínio próprio funcionam, mas os
filtros de spam desconfiam mais; verifique também a caixa de spam. O Brevo
exibe um aviso de que remetentes "freemail" não seguem as regras de Google,
Yahoo e Microsoft (DKIM/DMARC); mesmo assim, o envio funcionou.

Verificação (14/11/2026): com `BREVO_API_KEY` no Render,
`POST /auth/resend-verification` entregou o código na caixa de entrada e a
conta foi verificada por `POST /auth/verify-email`. Atenção: o endpoint de
reenvio responde 200 mesmo quando a entrega falha (a falha vai só para o log),
então a confirmação é a chegada do e-mail ou o log do Brevo/Render.

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

### Farol Admin (Vercel, plano Hobby)

O painel (Next.js, repositório `farol-admin`) foi publicado na Vercel, que
detecta o Next.js e sobrescreve `X-Forwarded-For` com o IP real do navegador,
como o painel espera. Configuração:

1. Importar o repositório na Vercel; única variável:
   `CRASHMAP_API_URL=https://<serviço>.onrender.com` (sem barra final).
2. Região das funções: Washington, D.C. (`iad1`), perto da API.
3. No Render, `ADMIN_PANEL_URL` = endereço `https://….vercel.app` do painel,
   para que os convites de moderador levem o link direto.

Verificação (14/11/2026): `/login` responde 200; uma página do painel aberta
com um refresh token inválido redireciona para `/login` e limpa os cookies
(`Secure`, `HttpOnly`, `SameSite=lax`), o que prova que o painel alcançou a
API e ela recusou o token.

**Limitação conhecida:** a API só confia no `X-Forwarded-For` vindo da
Cloudflare e da rede interna do Render (passo 6). O servidor do painel na
Vercel usa IPs dinâmicos e não está nessa lista, então, nas ações feitas pelo
painel, a API registra o IP da Vercel, não o do moderador (auditoria e limite
de tentativas do login do painel). A correção planejada é o painel enviar o IP
num cabeçalho assinado com um segredo compartilhado.

### Farol (Android)

O app precisa apontar para `https://<serviço>.onrender.com` e ser gerado como
APK (distribuição direta) ou publicado na Google Play.

## Primeiro administrador

O papel `admin` só é concedido pelo script `admin:grant-role`, que exige
e-mail verificado e registra a alteração na auditoria.

1. Criar a conta (app ou `POST /auth/register` em `/docs`) e verificar o
   e-mail (`POST /auth/verify-email`, autenticado com o `accessToken`).
2. No terminal local, apontando temporariamente para o banco de produção:

```powershell
$env:DATABASE_URL = "<string do Neon>"
pnpm admin:grant-role <email> admin
Remove-Item Env:DATABASE_URL
```

O último comando é obrigatório: sem ele, comandos seguintes na mesma janela
(como `pnpm test`, que apaga dados de teste) rodariam contra a produção.

Se a string do banco for exposta (em chat, print ou log), gere uma nova senha
para o papel no Neon e atualize `DATABASE_URL` no Render (com redeploy) e no
secret do GitHub. Conexões já abertas continuam funcionando após a troca; para
confirmar, reinicie o serviço e verifique `/health` com `uptime` baixo.

## Passo 6 — IP real do cliente (`TRUST_PROXY`)

A API usa o IP do cliente nos limites de tentativas (login, cadastro, senha) e
na auditoria. No Render, a requisição chega por um balanceador que **acrescenta**
o IP ao cabeçalho `X-Forwarded-For` sem limpar o que o cliente enviou, então
`TRUST_PROXY=true` permitiria falsificar o IP. A documentação do Render não
informa a cadeia de proxies; ela foi medida em 14/11/2026.

### Como foi medido

Requisições a `/health?probe-<marca>` com um IP falso no cabeçalho
(`X-Forwarded-For: 203.0.113.77`), conferindo no log do Render o
`remoteAddress` registrado para cada valor de `TRUST_PROXY`:

| `TRUST_PROXY` | `remoteAddress` | Conclusão |
|---|---|---|
| `1` | `10.31.95.109` | há um proxy interno na rede privada `10.x` |
| `10.0.0.0/8` | `127.0.0.1` | antes dele, um proxy local no próprio contêiner |
| `127.0.0.0/8,10.0.0.0/8,::1` | `104.23.209.211` | a Cloudflare (`104.16.0.0/13`) fica na frente do Render |
| interno + faixas da Cloudflare | IP público real do cliente | correto |

O IP falso nunca foi aceito. Cadeia observada:

```text
cliente → Cloudflare → balanceador Render → proxy 10.x → proxy 127.0.0.1 → API
```

### Valor em uso

Endereços internos mais as faixas publicadas pela Cloudflare em
<https://www.cloudflare.com/ips/> (consultadas em 14/11/2026), em uma linha:

```text
127.0.0.0/8,10.0.0.0/8,::1,173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22,2400:cb00::/32,2606:4700::/32,2803:f800::/32,2405:b500::/32,2405:8100::/32,2a06:98c0::/29,2c0f:f248::/32
```

A API lê o cabeçalho da direita para a esquerda, pula os proxies dessa lista e
usa o primeiro IP de fora dela. O que o cliente escreve no cabeçalho fica à
esquerda do IP real e nunca é usado. Uma lista foi preferida a um número fixo
(aqui seria `3`) porque continua correta se a quantidade de saltos internos
mudar.

**Manutenção:** se o log voltar a mostrar um IP da Cloudflare em
`remoteAddress`, atualize as faixas a partir da página da Cloudflare.

## Atualizações

Todo push na branch `development` dispara um novo deploy, e as migrations
novas são aplicadas no build. Para aplicar uma migration manualmente:

```bash
DATABASE_URL="<string do Neon>" pnpm prisma migrate deploy
```
