# Sincronização automática dos dados abertos da PRF

Documento técnico da importação periódica das ocorrências oficiais da Polícia
Rodoviária Federal (PRF) para o município de Imperatriz–MA na CrashMap API.

Convenção usada neste documento:

- **[Implementado e verificado]**: código presente no repositório e exercitado
  por testes automatizados ou por execução real registrada aqui.
- **[Implementado, não verificado em produção]**: código presente, mas ainda não
  executado no ambiente-alvo.
- **[Recomendação futura]**: não implementado.

Data da verificação: 14/11/2026.

---

## 1. Contexto e situação anterior

A API já distinguia as duas origens de ocorrências no modelo `Accident`:

| Campo | Relato do app | Registro PRF |
|---|---|---|
| `source` | `APP` | `PRF` |
| `created_by_id` | usuário autor | `null` |
| `moderation_status` | começa `PENDING` | `APPROVED` |
| `source_record_id` | `null` | `id` da PRF |
| `source_year` | `null` | ano do arquivo |
| `source_record_key` | `null` | `"{ano}:{id}"` (índice único) |

A moderação só considera `source = APP` (`accident-moderation.service.ts`),
então os registros oficiais nunca entram na fila do Farol Admin. Essa regra não
foi alterada.

Antes desta implementação havia um importador de CSV (`import:prf`), um script
de download (`sync:prf`) e um workflow mensal no GitHub Actions. A análise
encontrou os seguintes problemas, todos tratados aqui:

1. As duas execuções agendadas (01/10 e 01/11/2026) falharam no passo
   "Generate Prisma client", porque não havia banco nem secrets configurados.
2. O CSV da PRF (Windows-1252) era lido como UTF-8, o que gravava textos
   corrompidos (`Rea��o tardia…`).
3. Toda execução regravava todos os registros, avançando `updated_at` mesmo sem
   mudança. Isso invalidava a versão do mapa (`GET /accidents/map/version`) e
   forçava o Farol a baixar o mapa de novo.
4. A atualização reescrevia `moderation_status`.
5. Não havia detecção de publicação nova, histórico de execuções, contagem de
   rejeitados, novas tentativas em falhas de rede nem trava no banco.
6. O link e o ano eram fixos, e as correções que a PRF publica em anos
   anteriores não eram capturadas.

---

## 2. Fonte dos dados [verificado em 14/11/2026]

- **Catálogo oficial:**
  `https://www.gov.br/prf/pt-br/acesso-a-informacao/dados-abertos/dados-abertos-da-prf`,
  seção "BAT: Boletim de Acidente de Trânsito". Declara "Frequência de
  atualização: Mensal", sem dia fixo e sem data por arquivo.
- **Base usada:** "Documento CSV de Acidentes AAAA (Agrupados por ocorrência)".
- **Hospedagem:** cada link "Baixar planilha" aponta para o Google Drive
  (`drive.google.com/file/d/<id>/view…`). Não existe API nem catálogo legível
  por máquina.
- **Arquivo de 2026 observado:** `datatran2026.zip`, 2.818.326 bytes,
  `Last-Modified: 31/10/2026`, contendo `datatran2026.csv` com 54.895 linhas.
  As datas vão de 01/01/2026 a 30/09/2026. O Drive não envia `ETag`.
- **Correções retroativas:** o arquivo de 2024 tinha `Last-Modified` de
  23/09/2026, ou seja, a PRF revisa anos anteriores.
- **Inconsistência do catálogo:** alguns IDs do Drive se repetem entre anos.
  A sincronização confere o ano pelo nome do arquivo.

### Formato do CSV

| Característica | Valor |
|---|---|
| Codificação | ISO-8859-1 / Windows-1252 |
| Separador | `;` (campos de texto entre aspas, podendo conter `;`) |
| Fim de linha | CRLF |
| Decimal | vírgula (`-5,201382`, `252,4`) |
| Data / hora | `AAAA-MM-DD` / `HH:MM:SS` |
| Identificação geográfica | `uf` e `municipio` em texto, sem código IBGE |

Colunas usadas: `id`, `data_inversa`, `horario`, `uf`, `br`, `km`, `municipio`,
`causa_acidente`, `tipo_acidente`, `condicao_metereologica` (grafia da PRF),
`mortos`, `feridos_leves`, `feridos_graves`, `veiculos`, `latitude` e
`longitude`.

---

## 3. Arquitetura [implementado e verificado]

```text
src/modules/prf-sync/
├── prf-sync.service.ts   orquestração: trava, anos, detecção de mudança, registro
├── prf-source.ts         catálogo, download com novas tentativas, HEAD, SHA-256, ZIP
├── prf-csv.ts            leitura do CSV (Windows-1252 → UTF-8) e validação do cabeçalho
├── prf-mapper.ts         filtro Imperatriz–MA, validação e transformação
├── prf-persist.ts        comparação campo a campo e gravação transacional
├── prf-sync.cli.ts       argumentos de linha de comando
└── prf-sync.types.ts
src/shared/scripts/
├── sync-prf.ts           pnpm sync:prf    (fonte remota)
└── import-prf.ts         pnpm import:prf  (arquivo local, sem internet)
.github/workflows/prf-sync.yml             agendamento diário
prisma/migrations/20261114140000_add_prf_import_runs/
```

Nenhuma dependência nova. Foram reaproveitadas `csv-parser` (movida de
`devDependencies` para `dependencies`, porque agora é usada por código em
`src/`) e `unzipper`. A decodificação usa o `TextDecoder` nativo do Node, e o
agendamento usa o GitHub Actions, que já existia.

### Alteração de esquema

Migração **aditiva**: nenhuma tabela ou coluna existente muda.

- `prf_import_runs`: uma linha por execução, com `trigger` (`schedule`,
  `manual` ou `file`), `dry_run`, `forced`, `status` (`RUNNING`, `SUCCEEDED` ou
  `FAILED`), `error`, `started_at` e `finished_at`.
- `prf_import_files`: uma linha por arquivo anual processado. Guarda ano, link,
  nome, tamanho, SHA-256, `Last-Modified` remoto, status (`IMPORTED`,
  `UNCHANGED`, `NOT_PUBLISHED` ou `FAILED`), contadores, `details` (JSON) e
  `error`.
- Índice único parcial `prf_import_runs_single_running`, que permite no máximo
  uma execução `RUNNING`. Ele fica só no SQL, como o índice parcial que já
  existia em `moderator_invites`.

**Justificativa:** o histórico persistido é necessário para detectar
publicações novas (comparando com a última importação), registrar início, fim,
status, erros e contagens, e implementar a trava contra execuções simultâneas
sem depender de uma conexão fixa.

**Migração segura:** aplicar com `pnpm prisma migrate deploy`. Para reverter,
basta remover as duas tabelas e os dois enums; nenhum dado existente depende
delas.

---

## 4. Fluxo da importação [implementado e verificado]

1. **Encerrar execuções abandonadas.** Execuções `RUNNING` com mais de 2 horas
   viram `FAILED` ("Execucao abandonada"). O job do Actions tem limite de
   30 minutos.
2. **Adquirir a trava.** A execução é inserida como `RUNNING`. Se já houver
   outra, o índice parcial rejeita a inserção e o comando termina com
   `PrfSyncLockedError` (código de saída 75) sem acessar a fonte.
3. **Definir os anos.** Usa `--year`/`PRF_SYNC_YEARS`. Sem eles, usa o ano
   corrente mais todos os anos PRF já presentes na base, o que captura as
   correções retroativas sem trazer anos novos sem pedido.
4. **Ler o catálogo.** Baixa a página oficial, com novas tentativas, e extrai
   o primeiro link "Baixar planilha" de cada linha "Agrupados por ocorrência".
   `PRF_SOURCE_URL` + `PRF_SOURCE_YEAR` (ou `--source-url`) substituem o
   catálogo para um único ano.
5. **Para cada ano:**
   1. Sem link no catálogo, o arquivo fica `NOT_PUBLISHED`, um aviso que não é
      falha (por exemplo, em janeiro, antes da primeira publicação do ano).
   2. **Pré-checagem barata (HEAD):** se o tamanho, o nome e o `Last-Modified`
      forem iguais aos da última importação bem-sucedida, o arquivo fica
      `UNCHANGED` sem download (`change_detection: "remote_metadata"`).
   3. **Download**, com tempo-limite e novas tentativas, calculando o SHA-256.
      Respostas HTML (link errado ou página de confirmação do Drive) e
      arquivos vazios são recusados.
   4. Se o SHA-256 for igual ao da última importação, o arquivo fica
      `UNCHANGED` (`change_detection: "sha256"`).
   5. **Extração:** ZIP detectado pela assinatura `PK`, depois o CSV
      `datatran*.csv`. O ano no nome do arquivo precisa ser o esperado.
   6. **Leitura:** decodificação Windows-1252 e validação do cabeçalho antes
      de qualquer linha.
   7. **Filtro:** `uf = "MA"` e `municipio = "IMPERATRIZ"`, comparação exata
      sem acentos. O importador anterior usava "contém IMPERATRIZ", o que
      também casaria com outros municípios se não houvesse o filtro de UF.
   8. **Validação por linha** (motivos de rejeição): `missing_id`,
      `invalid_date` (inclusive datas inexistentes e horas inválidas),
      `invalid_coordinates`, `year_mismatch` (data fora do ano do arquivo) e
      `duplicated_id` (id repetido no mesmo arquivo).
   9. **Travas de sanidade**, nas quais o arquivo inteiro falha sem gravar:
      CSV sem linhas; todas as linhas de Imperatriz fora do ano; ou zero
      ocorrências de Imperatriz quando a importação anterior tinha alguma.
   10. **Transformação** com as mesmas regras do importador anterior (seção 5).
   11. **Gravação** (seção 6) numa única transação por arquivo.
   12. **Ausentes:** chaves já gravadas daquele ano que não aparecem mais na
       publicação são contadas e listadas em `details`, mas **nunca apagadas**.
6. **Fechar a execução:** `SUCCEEDED` se nenhum arquivo falhou, senão `FAILED`.
   O resultado vai para o log (JSON) e para as tabelas.

Cada execução registra estes contadores por arquivo: `rows_read`,
`rows_matched`, `inserted`, `updated`, `unchanged`, `rejected` (com o motivo),
`missing_from_source` e `staff_edits_overwritten`. `details.changed_fields`
mostra quantos registros mudaram em cada campo.

---

## 5. Transformação dos registros

Regras herdadas do importador anterior, mantidas para não mudar o que os
clientes exibem:

| Campo do `Accident` | Origem |
|---|---|
| `tipo_acidente` | `tipo_acidente` (vazio: "Acidente nao especificado") |
| `severity` | `critical` se houve morto, `high` se houve ferido grave, `medium` se houve ferido leve, senão `low` |
| `classificacao_acidente` | `com_vitima` se houve morto ou ferido, senão `sem_vitima` |
| `condicao_meteorologica` | contém "chuva" → `chuva`; "nublado" → `nublado`; "garoa"/"chuvisco" → `garoa`; demais → `ceu_claro` |
| `description` | `Causa: … \| N morto(s) e N veiculo(s) envolvido(s) \| BR-… Km … (MUNICIPIO - UF)` |
| `latitude` / `longitude` | vírgula decimal convertida |
| `occurred_at` | data + hora da PRF gravadas como UTC (seção 10) |
| `source`, `moderation_status` | `PRF`, `APPROVED` (só na criação) |

---

## 6. Identificação e atualização dos registros

- **Chave:** `source_record_key = "{ano}:{id}"`, com índice único já existente.
- **Novo:** criado com `source = PRF` e `moderation_status = APPROVED`.
- **Existente:** os dez campos oficiais (`tipo_acidente`,
  `classificacao_acidente`, `condicao_meteorologica`, `description`,
  `latitude`, `longitude`, `occurred_at`, `severity`, `source_record_id` e
  `source_year`) são comparados um a um, e só os que mudaram são gravados.
  - Sem diferença, o registro não é tocado e o `updated_at` não avança. A
    versão do mapa só muda quando o dado oficial realmente mudou.
  - Na atualização, **não** são alterados `moderation_status`, campos de
    moderação, `created_by_id`, comentários, imagens, votos de confiança nem o
    histórico de moderação. Os relacionamentos ficam ligados ao mesmo `id`.
- **Edições de staff (política D1):** o dado oficial prevalece. Quando um
  registro alterado tem um `REPORT_EDITED_BY_STAFF` na auditoria, o `id` vai
  para `staff_edits_overwritten_ids` e é contado em `staff_edits_overwritten`.
- **Removidos da fonte (política D2):** não são apagados; ficam contados em
  `missing_from_source`.
- **Colisão de chave:** se a chave pertencer a um registro que não é da PRF,
  o arquivo falha inteiro e nada é gravado.
- **Atomicidade:** cada arquivo é aplicado numa transação. Uma falha no meio
  não deixa o arquivo pela metade, e a próxima execução refaz o processamento,
  porque a última importação válida ainda não registra aquele arquivo.

---

## 7. Agendamento

**[Implementado, não verificado em produção]** O workflow
`.github/workflows/prf-sync.yml`:

- roda **diariamente** às 09:17 UTC (06:17 em Brasília). Como a PRF não publica
  em dia fixo, a verificação diária detecta a publicação em até um dia. Sem
  novidade, só faz requisições HEAD e não grava ocorrências;
- aceita execução manual (`workflow_dispatch`) com as entradas `years`, `force`
  e `dry_run`;
- usa `concurrency: prf-sync`, além da trava no banco;
- se `DATABASE_URL`, `ACCESS_TOKEN_SECRET` ou `REFRESH_TOKEN_SECRET` não
  existirem, emite um aviso e termina **sem falhar**. Isso evita a falha mensal
  observada antes de haver ambiente de produção;
- não aplica migrations; isso cabe ao processo de deploy.

Motivo da escolha: a API ainda não está implantada e o projeto já usava o
GitHub Actions. O agendamento independe de onde a API vai rodar, inclusive em
hospedagens que hibernam, e não exige serviço novo.

---

## 8. Configuração

| Variável | Obrigatória | Uso |
|---|---|---|
| `DATABASE_URL` | sim | banco alvo |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | sim | exigidas pela validação de ambiente da API (`env.ts`) |
| `PRF_SYNC_YEARS` | não | anos a sincronizar: `2026`, `2025,2026` ou `2022-2026` |
| `PRF_SOURCE_URL` + `PRF_SOURCE_YEAR` | não | link fixo para um ano, no lugar do catálogo |
| `PRF_CATALOG_URL` | não | URL alternativa do catálogo (testes ou espelho) |
| `PRF_SYNC_TRIGGER` | não | `schedule` no Actions; padrão `manual` |

No GitHub: os secrets `DATABASE_URL`, `ACCESS_TOKEN_SECRET` e
`REFRESH_TOKEN_SECRET` (e opcionalmente `PRF_SOURCE_URL`), mais as variables
opcionais `PRF_SYNC_YEARS` e `PRF_SOURCE_YEAR`.

---

## 9. Execução manual

```bash
pnpm prisma migrate deploy                 # uma vez, para criar as tabelas
pnpm sync:prf                              # anos padrão
pnpm sync:prf --dry-run                    # valida e compara, sem gravar ocorrências
pnpm sync:prf --year=2022-2026             # carga histórica
pnpm sync:prf --year=2026 --force          # reprocessa mesmo sem mudança
pnpm import:prf ./datatran2026.zip         # arquivo já baixado (CSV ou ZIP)
pnpm import:prf ./acidentes.csv --year=2026
```

Códigos de saída: `0` sucesso; `1` falha (detalhes no JSON impresso e em
`prf_import_files.error`); `75` outra execução em andamento.

Também é possível rodar pelo GitHub (Actions → "Sync PRF accidents" → "Run
workflow").

Para consultar o histórico:

```sql
SELECT r.started_at, r.trigger, r.status, f.source_year, f.status,
       f.inserted, f.updated, f.unchanged, f.rejected, f.missing_from_source, f.error
FROM prf_import_runs r JOIN prf_import_files f ON f.run_id = r.id
ORDER BY r.started_at DESC LIMIT 20;
```

---

## 10. Tratamento de erros

| Situação | Comportamento |
|---|---|
| Falha de rede, tempo-limite, HTTP 408/429/5xx | 3 tentativas com espera exponencial (5 s, 10 s); depois o arquivo fica `FAILED` |
| HTTP 4xx (exceto 408/429) | falha imediata, sem nova tentativa |
| Catálogo indisponível ou sem links | os anos sem link fixo ficam `FAILED`, com a mensagem |
| Ano ausente do catálogo | `NOT_PUBLISHED` (aviso, não falha) |
| Resposta HTML ou arquivo vazio | `FAILED`, nada gravado |
| ZIP sem CSV de ocorrências, cabeçalho incompleto, CSV vazio | `FAILED`, nada gravado |
| Arquivo de outro ano no link | `FAILED`, nada gravado |
| Zero ocorrências de Imperatriz quando antes havia | `FAILED`, nada gravado |
| Linha inválida | rejeitada e contada por motivo; as demais seguem |
| Erro durante a gravação | transação desfeita; arquivo `FAILED`; a próxima execução reprocessa |
| Falha em um ano | os outros anos continuam; a execução fica `FAILED` |
| Execução simultânea | recusada (código 75) |
| Processo morto no meio | a execução fica `RUNNING` e é encerrada como abandonada após 2 h |

---

## 11. Testes e resultados

### Testes automatizados (`tests/prf-sync.test.ts`, 16 testes)

Rodam contra o PostgreSQL local, como o restante da suíte. A fonte PRF é
simulada (catálogo e arquivos em memória, CSV codificado em Windows-1252) e os
anos usados são fictícios (2098/2099), para não tocar nos dados reais.

| Cenário pedido | Teste(s) |
|---|---|
| 1. Importação de novas ocorrências | importa só Imperatriz–MA (exclui Santo Amaro da Imperatriz–SC e outro município do MA), decodifica acentos, grava `PRF`/`APPROVED`, não aparece na moderação, aparece no mapa, registra a execução |
| 2. Reexecução sem duplicações | mesma publicação → `UNCHANGED` sem download; metadados novos com mesmo conteúdo → `UNCHANGED` por SHA-256; `--force` → 0 inserções, 0 atualizações e `updated_at` idêntico |
| 3. Atualização de registros | correção atualiza só o registro afetado; comentário, voto e status preservados; registro ausente não é apagado; edição de staff sobrescrita e registrada |
| 4. Dados inválidos | cinco motivos de rejeição contados; cabeçalho incompleto falha sem gravar; arquivo de outro ano é recusado |
| 5. Fonte indisponível | catálogo com HTTP 503 → 3 tentativas e falha limpa; erro de rede e página HTML → `FAILED`; ano não publicado → aviso |
| 6. Falhas parciais e recuperação | falha em um ano preserva o outro e a execução seguinte recupera; colisão de chave no meio do arquivo → nada gravado; simulação não conta como importação |
| Execuções simultâneas | segunda execução recusada; execução abandonada liberada |
| Unidades | parser do catálogo, lista de anos, regras de transformação e filtro exato |

Para checar que os testes realmente detectam regressões, desativei
temporariamente a comparação campo a campo: os testes 2 e 3 falharam, como
esperado. O código foi restaurado em seguida.

### Suíte completa (`pnpm test`), cenário 7: preservação dos fluxos

- Antes da mudança: 46 testes, 45 aprovados, 1 pulado, 0 falhas.
- Depois da mudança: **62 testes, 61 aprovados, 1 pulado, 0 falhas.**
- O teste pulado é o upload real para o Cloudinary, que já era pulado antes
  (depende de credenciais).
- O teste de contrato (`tests/api-contract.test.ts`, que compara com
  `tests/__snapshots__/api-contract.json`) passou: rotas e esquemas de
  requisição e resposta não mudaram.
- `pnpm build` (TypeScript) sem erros.

### Execução real contra a fonte oficial (banco local, 14/11/2026)

| Execução | Resultado `datatran2026.zip` |
|---|---|
| `sync:prf --dry-run` | 54.895 linhas lidas, 92 de Imperatriz–MA; 10 novas, 75 a corrigir, 7 iguais; nada gravado |
| `sync:prf` | `IMPORTED`: 10 inseridas, 75 atualizadas (`tipo_acidente` 71, `description` 66: correção de acentos), 7 inalteradas, 0 rejeitadas |
| `sync:prf` (de novo) | `UNCHANGED` por metadados remotos, sem download |
| `sync:prf --force` | 92 inalteradas, 0 escritas |
| `import:prf datatran2026.zip` | ZIP local extraído; 92 inalteradas |

Depois disso, a base local tinha 92 registros PRF de 2026, nenhuma chave
duplicada e nenhum caractere corrompido. As 10 novas eram as ocorrências de
setembro de 2026 que ainda não estavam importadas.

### Não verificado

- Execução agendada ou manual no GitHub Actions: não há banco de produção nem
  secrets configurados. O YAML foi revisado, mas não executado.
- Arquivos de outros anos (2022–2025) não foram importados; só os metadados
  (HEAD) de 2024 e 2025 foram consultados.

---

## 12. Limitações conhecidas

1. **Catálogo em HTML:** a descoberta depende do texto "Documento CSV de
   Acidentes AAAA (Agrupados por ocorrência)" e do link na mesma linha da
   tabela. Uma mudança de layout faz a execução falhar com uma mensagem
   explícita; nesse caso, `PRF_SOURCE_URL` funciona como contorno.
2. **Google Drive:** arquivos grandes podem exigir uma página de confirmação.
   Ela é detectada e tratada como falha, não contornada. Os arquivos atuais
   (cerca de 3–4 MB) baixam diretamente.
3. **Fuso horário (decisão D4):** data e hora da PRF são horário local e são
   gravadas como UTC, como o importador anterior já fazia. A correção mudaria
   todos os registros e o que os clientes exibem, por isso ficou fora do
   escopo.
4. **Clima:** "Sol", "Nevoeiro/Neblina", "Vento", "Granizo", "Neve" e
   "Ignorado" viram `ceu_claro`, conforme a regra herdada e os quatro valores
   do enum atual.
5. **Classificação:** é derivada das contagens de vítimas; a coluna
   `classificacao_acidente` da PRF não é usada (regra herdada).
6. **Geografia:** o filtro depende do nome do município, porque a fonte não
   publica código IBGE.
7. **Registros removidos pela PRF** permanecem na base (decisão D2).
8. **Edições de staff** em registros PRF são sobrescritas quando o dado
   oficial muda (decisão D1), com registro no log.
9. **Anos considerados:** sem configuração, entram o ano corrente e os anos já
   importados. Anos nunca importados exigem `--year` ou `PRF_SYNC_YEARS`.
10. **GitHub Actions:** o horário agendado pode atrasar. Em repositórios
    públicos, o GitHub desativa workflows agendados após um longo período sem
    atividade no repositório.
11. **Histórico:** as tabelas `prf_import_*` crescem sem política de retenção,
    e não há endpoint para consultá-las; a consulta é feita direto no banco.
12. **Testes:** usam o banco configurado em `.env`, como o resto da suíte, e
    não um banco isolado.

## 13. Recomendações futuras (não implementadas)

- Endpoint ou tela no Farol Admin com o histórico de sincronizações.
- Política de retenção para `prf_import_runs` e `prf_import_files`.
- Notificação (e-mail ou push) quando uma sincronização falhar.
- Converter `occurred_at` para UTC real, com migração de dados e ajuste
  coordenado nos clientes.
- Ampliar o enum de condição meteorológica para cobrir todos os valores da PRF.
- Banco isolado para a suíte de testes.
