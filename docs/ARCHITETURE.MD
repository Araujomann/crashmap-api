# Arquitetura do CrashMap

## Objetivo

A arquitetura do CrashMap foi projetada para ser simples no início, mas capaz de crescer conforme novas funcionalidades forem adicionadas.

Optamos por uma arquitetura híbrida, combinando organização por funcionalidades (Feature-first) com uma área compartilhada (`shared`) para recursos reutilizáveis.

Essa abordagem mantém o projeto organizado sem adicionar complexidade desnecessária.

---

# Estrutura do projeto

```text
src/
│
├── modules/
│   ├── auth/
│   ├── users/
│   ├── accidents/
│   ├── comments/
│   ├── images/
│   ├── moderation/
│   ├── notifications/
│   └── dashboard/
│
├── shared/
│   ├── config/
│   ├── database/
│   ├── middleware/
│   ├── services/
│   ├── utils/
│   ├── errors/
│   └── types/
│
├── app.ts
└── server.ts
```

---

# Filosofia

A regra principal é simples:

> Tudo que pertence a uma funcionalidade fica em `modules`.
>
> Tudo que pode ser reutilizado por qualquer funcionalidade fica em `shared`.

---

# Modules

Cada pasta dentro de `modules` representa um domínio da aplicação.

Exemplo:

```text
modules/
    auth/
    users/
    accidents/
    comments/
```

Cada módulo é responsável apenas pela sua própria regra de negócio.

Por exemplo, tudo relacionado à autenticação ficará dentro de:

```text
modules/auth/
```

Enquanto tudo relacionado aos acidentes ficará em:

```text
modules/accidents/
```

---

# Estrutura interna de um módulo

Cada módulo pode possuir arquivos como:

```text
auth/
├── auth.controller.ts
├── auth.service.ts
├── auth.routes.ts
├── auth.schema.ts
└── auth.types.ts
```

Nem todos os módulos precisam possuir exatamente esses arquivos.

Cada módulo terá apenas aquilo que realmente precisar.

---

# Responsabilidade de cada arquivo

## Routes

Responsável por registrar as rotas da API.

Exemplo:

```
POST /login
POST /register
```

As rotas apenas encaminham a requisição para o controller.

Não possuem regra de negócio.

---

## Controller

O controller faz a comunicação entre o Fastify e a aplicação.

Suas responsabilidades são:

- receber a requisição;
- validar os dados recebidos (quando necessário);
- chamar o service;
- retornar a resposta HTTP.

O controller **nunca acessa o banco de dados diretamente**.

---

## Service

O service contém toda a regra de negócio.

Exemplos:

- validar senha;
- verificar permissões;
- criar usuários;
- gerar tokens JWT;
- registrar acidentes.

Sempre que houver lógica da aplicação, ela deverá ficar no service.

---

## Schema

Responsável pela validação utilizando Zod.

Cada módulo possui seus próprios schemas.

Exemplo:

```text
LoginSchema

RegisterSchema

CreateAccidentSchema
```

---

## Types

Tipos específicos daquele módulo.

Caso um tipo seja utilizado por vários módulos, ele deve ser movido para:

```text
shared/types
```

---

# Shared

A pasta `shared` reúne tudo aquilo que é utilizado por diversos módulos.

Ela existe para evitar duplicação de código.

---

## Config

Arquivos de configuração.

Exemplos:

- variáveis de ambiente;
- configuração de autenticação;
- constantes globais.

---

## Database

Responsável pelo acesso ao banco de dados.

O cliente do Prisma ficará aqui.

Exemplo:

```text
shared/database/prisma.ts
```

Existe apenas uma instância do PrismaClient para toda a aplicação.

---

## Middleware

Middlewares reutilizados pela aplicação.

Exemplos:

- autenticação;
- tratamento de erros;
- validação.

---

## Services

Integrações com serviços externos.

Exemplos:

- Cloudinary;
- envio de e-mails;
- armazenamento de arquivos;
- notificações push.

Esses serviços não pertencem a um módulo específico.

---

## Utils

Funções utilitárias reutilizáveis.

Exemplos:

- geração de hash;
- geração de JWT;
- manipulação de datas.

Importante:

A pasta `utils` nunca deve conter regra de negócio.

---

## Errors

Classes de erro personalizadas.

Exemplo:

```text
AppError
AuthenticationError
ValidationError
```

---

## Types

Tipos compartilhados por toda a aplicação.

---

# Fluxo de uma requisição

Toda requisição deve seguir este fluxo:

```text
Cliente

↓

Route

↓

Controller

↓

Service

↓

Prisma

↓

PostgreSQL
```

---

# O que NÃO fazer

## Controller acessando Prisma

❌ Errado

```text
Controller

↓

Prisma
```

O controller nunca conversa diretamente com o banco.

Sempre existe um service entre eles.

---

## Regra de negócio em utils

A pasta `utils` deve conter apenas funções genéricas.

Ela não deve decidir regras da aplicação.

---

## Duplicar código

Sempre que uma funcionalidade puder ser utilizada por mais de um módulo, ela deverá ser movida para `shared`.

---

# Por que escolhemos essa arquitetura?

Inicialmente consideramos utilizar uma arquitetura em camadas (Layered Architecture), organizada por pastas como:

```text
controllers/
services/
routes/
middlewares/
```

Essa abordagem é excelente para projetos pequenos e é bastante difundida.

Entretanto, o CrashMap possui diversos domínios independentes, como:

- autenticação;
- usuários;
- acidentes;
- imagens;
- comentários;
- notificações;
- moderação;
- dashboard;
- integração com dados da PRF;
- geolocalização utilizando PostGIS.

À medida que esses módulos crescem, uma arquitetura organizada apenas por tipo de arquivo tende a espalhar o código em muitas pastas diferentes.

Optamos por organizar o projeto por funcionalidades, mantendo tudo relacionado a um domínio em um único lugar.

Ao mesmo tempo, utilizamos a pasta `shared` para centralizar tudo que pode ser reutilizado entre os módulos.

Essa abordagem oferece um bom equilíbrio entre simplicidade, organização e escalabilidade.

---

# Princípios que seguimos

- Cada módulo possui uma única responsabilidade.
- Controllers não possuem regra de negócio.
- Services concentram toda a lógica da aplicação.
- O acesso ao banco ocorre apenas através do Prisma.
- Recursos compartilhados ficam em `shared`.
- Evitamos duplicação de código.
- Preferimos organização por domínio em vez de organização por tipo de arquivo.
- A arquitetura deve continuar simples mesmo com o crescimento do projeto.

---

> Este documento é um guia de arquitetura, não uma regra imutável.
>
> Se, durante o desenvolvimento do CrashMap, surgir uma abordagem melhor ou mais adequada, a arquitetura poderá evoluir junto com o projeto. O objetivo é manter o código organizado, compreensível e fácil de manter, e não seguir uma estrutura apenas por tradição.