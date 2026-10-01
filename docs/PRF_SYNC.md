# Sincronizacao da PRF

O projeto possui dois comandos relacionados:

```text
pnpm import:prf ./acidentes-2026.csv --year=2026
pnpm sync:prf
```

`import:prf` processa um arquivo local. `sync:prf` baixa o arquivo configurado em `PRF_SOURCE_URL`, aceita CSV ou ZIP, extrai o CSV de ocorrencias e executa a importacao idempotente.

## Fonte dos dados

A pagina oficial da PRF e o catalogo dos arquivos:

https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf

Use a base `Documento CSV de Acidentes {ano} (Agrupados por ocorrencia)`. O valor de `PRF_SOURCE_URL` deve ser o endereco copiado do botao `Baixar planilha`, e nao o endereco da pagina do catalogo. Se a PRF disponibilizar um ZIP, o job o extraira automaticamente.

## Variaveis

Para execucao local, configure no `.env`:

```env
PRF_SOURCE_URL="https://.../arquivo-da-prf.zip"
PRF_SOURCE_YEAR=2026
```

No GitHub Actions, configure estes GitHub Secrets:

- `DATABASE_URL`
- `ACCESS_TOKEN_SECRET`
- `REFRESH_TOKEN_SECRET`
- `PRF_SOURCE_URL`

Configure `PRF_SOURCE_YEAR` como uma Repository variable. Quando a URL mudar para o arquivo do novo ano, atualize a secret e a variable antes da primeira sincronizacao daquele ano.

## Primeira carga

Antes de ativar o agendamento, baixe e importe os anos historicos necessarios, por exemplo 2022 a 2026. Depois, execute o workflow manualmente usando `Run workflow` e confira as contagens no log.

As migrations devem ser aplicadas pelo fluxo de deploy:

```text
pnpm prisma migrate deploy
```

O workflow mensal nao aplica migrations.

## Agendamento

O workflow `.github/workflows/prf-sync.yml` executa no primeiro dia de cada mes as 03:17 UTC e tambem pode ser disparado manualmente. O horario do GitHub Actions e UTC e pode sofrer pequeno atraso.
