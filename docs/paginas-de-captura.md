# Páginas de Captura, domínios e créditos

## Por que existe

O MyChatCRM só sabia receber lead da Meta, que entrega formulário nativo (Lead
Ads). O Google não entrega — quem anuncia lá precisa de uma página. Sem página,
o produto estava proibido de existir no maior canal de tráfego pago do mundo.

A página não é um produto novo. É o adaptador que faltava para abrir o Google
como fonte de leads, do mesmo jeito que o Meta Lead Ads já está aberto.

## Ligar o módulo

Sem `LANDING_PAGES_DOMAIN` **e** sem `LANDING_CUSTOM_DOMAINS_ENABLED`, o módulo
fica **adormecido**: dá para criar e gerar páginas, mas não para publicar, e a
aplicação comporta-se exatamente como antes em todos os hosts.

1. **Aplicar a migração** `supabase/migrations/20260918100000_landing_pages_credits_domains_v1.sql`.
   Sem ela o painel mostra um aviso e não deixa criar nada.
2. **Escolher um caminho de endereço** (ou os dois):
   - `LANDING_CUSTOM_DOMAINS_ENABLED=true` — o cliente traz o domínio dele.
     Cada domínio é registado um a um na hospedagem e **funciona em qualquer
     plano**. É o caminho mais rápido para ter alguém no ar hoje.
   - `LANDING_PAGES_DOMAIN=<domínio>` — endereço grátis `<slug>.<domínio>`.
     Precisa de um domínio separado e de um **wildcard** `*.<domínio>`, que
     exige plano pago na hospedagem.
3. **Definir as restantes variáveis** (ver `.env.example`, secção
   "PÁGINAS DE CAPTURA").

### Por que o domínio TEM de ser separado

Página de cliente e painel na mesma origem significa que um único cliente
mal-intencionado consegue fazer o Google Safe Browsing marcar o domínio inteiro
— e aí cai o login, o checkout e o painel de **todos** os outros clientes.
Se queimar, tem de queimar só o domínio das páginas.

## Como o roteamento funciona

`resolveLandingHost` (em `lib/landing/host-routing.ts`) é uma função **pura**
chamada no início do middleware, sem ida ao banco: isto roda em cada pedido do
painel inteiro.

| Host | Resultado |
|---|---|
| `mychatcrm.com(.br)`, `NEXT_PUBLIC_SITE_URL`, `*.vercel.app`, `localhost` | app, sempre |
| qualquer host, **sem `LANDING_PAGES_DOMAIN`** | app, sempre (módulo adormecido) |
| apex do domínio das páginas | app (institucional) |
| `<slug>.<domínio-das-páginas>` | página, resolvida por slug |
| qualquer outro host | página, resolvida por domínio ativo |

**Fecha para o app por omissão.** Sem domínio configurado o módulo não desvia
uma única requisição — "adormecido" quer dizer "não muda nada", não "muda um
pouco".

Num host de página, o caminho é classificado em três (`classifyLandingPath`):

- `page` → renderizador (`/sites/<host>/...` por reescrita interna)
- `passthrough` → serve o app sem reescrever: `/api/public/landing/*`,
  `/_next/*`, `favicon.ico`. **Reescrever isto mandava o POST do formulário
  para o renderizador** — a página ficava publicada e incapaz de captar.
- `blocked` → `/dashboard`, `/admin`, `/login`, `/checkout`, restante `/api/*`
  e `/sites/*` não existem neste domínio; redirecionam para `/`.

## Domínio próprio

Três origens, na tabela `landing_page_domains`:

- **`platform_subdomain`** — grátis, imediato, `<slug>.<domínio>`.
- **`byo`** — o cliente traz o que já tem. Nasce em `pending_dns`; só fica
  `active` depois do TXT de posse aparecer em `_mychatcrm.<host>`. Sem essa
  prova, bastava digitar o domínio de um concorrente para sequestrar o tráfego
  dele assim que o DNS apontasse para nós.
- **`purchased`** — comprado por nós. Nasce `active` (a posse é nossa) e o DNS é
  apontado no mesmo passo. Exige `HOSTINGER_API_TOKEN` **e**
  `LANDING_DOMAIN_PURCHASE_ENABLED=true` — é dinheiro a sair, e registo de
  domínio não se desfaz.

  A consulta de disponibilidade devolve `is_available` e `restriction` (o
  `.com.br` pede CPF ou CNPJ) mas **não devolve preço**, e a compra exige o
  `item_id` do **catálogo**, não o nome do domínio. As duas coisas vêm de
  `/api/billing/v1/catalog`, com cache de 6 h por TLD.

  A tela mostra o preço do **primeiro ano e o da renovação** — são diferentes
  (`.com.br`: R$ 39,99 depois R$ 64,99) e mostrar só o primeiro é o truque de
  venda que não vamos repetir.

Apex recebe `A`; subdomínio recebe `CNAME`. Apex não aceita CNAME, e subdomínio
com `A` quebra quando o IP da plataforma muda.

A verificação usa DNS sobre HTTPS (Cloudflare, com Google de reserva) em vez do
resolvedor do sistema: na Vercel o resolvedor local devolve cache antiga e o
cliente que acabou de criar o registo veria "não encontrámos" por horas.

## Créditos

Moeda universal do produto, não só das páginas. A regra que manda:
**crédito nunca compra hora humana.** Se uma ação precisar de alguém sentado
fazendo, ela não pertence a esta lista — vira serviço com preço próprio.

| Ação | Créditos |
|---|---|
| Gerar página completa | 5 |
| Gerar variante para teste A/B | 3 |
| Regenerar uma seção | 1 |
| Pacote de anúncios para Google | 2 |
| Imagem gerada | 1 |
| Configurar domínio próprio | 2 |

**Publicar não custa crédito** e voltar a uma versão anterior é grátis: quem já
pagou pela geração não pode ter receio de colocar no ar, senão ninguém testa
nada.

O movimento de saldo é uma transação no Postgres (`credits_move_v1`), com trava
de linha e chave de idempotência. Dois cliques simultâneos não gastam o mesmo
crédito; o webhook do Stripe reenviado não credita duas vezes.

**Se a geração falhar depois do débito, o crédito é devolvido** — automático, no
mesmo pedido.

### Páginas incluídas no plano

Solo 1 · Equipa 3 · Escala 10 · Enterprise 50. Página extra publicada é um
addon recorrente de R$ 39,90/mês (`landing_page_extra`), que reaproveita o
catálogo de addons existente em vez de inventar um segundo sistema de cobrança.

O limite é conferido **na publicação**, não na criação: rascunho é ilimitado.

## O que a página faz com o lead

1. Valida a submissão contra os campos da versão publicada (chave não declarada
   é descartada em silêncio — é um POST público).
2. Grava a submissão **antes** de tentar criar o lead. Se o CRM falhar, o
   contacto continua registado; o inverso perderia para sempre alguém que a
   campanha já pagou para trazer.
3. Cria/atualiza o lead com `attribution` (gclid, wbraid, gbraid, fbclid, utm_*)
   e `landing_page_id`.
4. Carimba equipa e dono a partir da regra de distribuição ligada à página.

### Não consome cota de leads atendidos

A cota conta **atendimento do agente**. Esta fase entrega o lead ao CRM sem
primeiro contacto automático, e o plano já promete "leads no CRM ilimitados".
Quando o primeiro contacto entrar, é aí que a cota passa a valer.

### Primeiro contacto automático: deliberadamente fora desta fase

O único caminho correto é o que `lib/server/meta-lead-ingest.ts` já usa —
estado de conversa, epoch de automação, autorização do agente, resposta gerada
pelo motor. Construir um segundo caminho paralelo de primeiro contacto é
exatamente o tipo de divergência que quebra o agente de um cliente em produção.
O lead cai no CRM e aparece em Conversas / Ofertas Ativas; a ligação com o motor
é um passo isolado, não uma reescrita.

## Atribuição

Guardada desde já, mesmo sem a importação de conversões ligada: **o clique passa
uma vez**. Um lead que chegou hoje sem `gclid` guardado nunca mais pode ser
ligado à campanha que o trouxe.

`wbraid`/`gbraid` são os substitutos do `gclid` em iOS — quem ignora os dois
perde a maior fatia do tráfego móvel.

A devolução da conversão ao Google (Offline Conversion Import + Enhanced
Conversions for Leads) é o passo seguinte e depende de um developer token da
Google Ads API, cuja aprovação demora semanas.

## Segurança

- `requireLandingAccess` é a porta única das rotas. O middleware valida papel em
  `/dashboard/*` e **nunca** em `/api/*` — cada rota de cliente precisa do seu
  próprio guard.
- **Leitura acompanha o menu** (titular, diretor e gerente; vendedor não):
  quem vê o item na barra lateral tem de conseguir abrir a tela, senão o painel
  mostra um erro em vez de conteúdo. **Escrita é só do titular** (`manageOnly`):
  publicar, arquivar, comprar domínio e gastar crédito.
- O conteúdo do banco entra como **texto** e é interpolado pelo React, que
  escapa. Não há `dangerouslySetInnerHTML` com conteúdo de tenant em lugar
  nenhum — só com a folha de estilos, montada a partir de cores validadas por
  regex hexadecimal.
- O formulário público tem limite por IP, campo-armadilha para robô e
  deduplicação por telefone numa janela de uma hora.
- O IP é guardado em hash, nunca em claro.

## Arquivar, nunca apagar — e o endereço não volta ao mercado

Arquivar mantém a linha, então o slug continua ocupado. É de propósito: um
endereço que já esteve num anúncio não pode ser reatribuído a outro tenant, ou
o tráfego residual de uma campanha antiga cairia na página de um estranho.

Pelo mesmo motivo a página arquivada guarda o histórico de submissões, que é a
prova de onde vieram os leads daquela campanha.

## Limitação conhecida: `robots.txt` e `sitemap.xml`

O matcher do middleware exclui `txt` e `xml` de propósito — sem isso o next-intl
reescrevia `/robots.txt` para `/pt-BR/robots.txt` e o site ficava sem mapa e sem
regras de rastreio (foi assim durante meses). O efeito colateral é que
`https://<domínio-do-cliente>/robots.txt` devolve o robots da MyChatCRM, com as
linhas `Host:` e `Sitemap:` a apontar para `www.mychatcrm.com.br`.

Impacto real é pequeno: a regra é `Allow: /`, então a página do cliente continua
rastreável, referência de sitemap entre domínios diferentes é ignorada pelo
Google, e as páginas de campanha nascem `noindex` de qualquer forma.

**Não corrigir mexendo no matcher.** Se um dia incomodar, a saída é servir um
robots por host a partir de um route handler que não dependa do middleware.

## Comportamento em falha

Nada aqui pode mostrar rasto de pilha no domínio comercial de um cliente:

- Migração por aplicar, env em falta ou banco fora do ar → **404**, não 500.
- Versão malformada no banco → normalizada para algo que renderiza; página sem
  formulário ganha um formulário padrão.
- Modo de manutenção do SaaS → a página continua a servir (o visitante veio de
  um anúncio pago); o formulário responde com erro amigável.

## Testes

- `lib/__tests__/landing-pages-certification.test.ts` — invariantes sob cenários
  gerados. 10 mil por omissão; para a certificação completa:

  ```bash
  LANDING_CERTIFICATION_SCENARIOS=1000000 npx vitest run lib/__tests__/landing-pages-certification.test.ts
  ```

- `lib/__tests__/landing-host-routing.test.ts` — casos nomeados da fronteira de
  segurança. É o ficheiro a ler antes de mexer no middleware.
