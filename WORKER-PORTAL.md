# Servidor do editor do Portal do Corretor

O portal fica em **https://tabelas.hliving.com.br** (arquivo `index.html`). O `portal.html` só leva os
links antigos para lá, e o painel das tabelas continua em `/hliving-tabelas.html` e no Admin do portal.

O **Admin → Textos, capas e fotos do portal** grava as edições num servidor só do portal, separado
do servidor de preços:

| | |
| --- | --- |
| Conta Cloudflare | Marketing (`marketing@hliving.com.br`) |
| Worker | `hliving-portal` |
| Endereço | https://hliving-portal.bold-resonance-24f8.workers.dev |
| Armazenamento | KV `hliving-portal`, ligado ao Worker como `PORTAL_KV` |
| Código | [`servidor-portal/worker.js`](servidor-portal/worker.js) (cópia do que está publicado) |

**O sistema de preços não muda.** O servidor principal (`hliving-proxy.jefearq.workers.dev`), o Apps
Script e a planilha continuam iguais. O editor de textos e mídia nunca grava neles; o painel das tabelas,
aberto dentro do portal, grava como sempre gravou.

## Senha

O **Admin** do portal pede a senha primeiro. Só depois de entrar aparecem as opções. É a mesma senha do
painel das tabelas, e ela não fica escrita em lugar nenhum. Um login vale para as duas opções:

1. O portal envia a senha para a ação `login` do servidor principal, como o próprio painel das tabelas
   faz. Senha errada para aqui, com uma única tentativa contada.
2. Com a senha certa, o token devolvido fica em `sessionStorage` como `hliving_token`, o mesmo nome que
   o painel usa. Por isso o painel das tabelas abre já logado dentro do portal. Ele só abre direto depois
   que os dados do servidor chegam; se não chegarem, pede a senha como sempre.
3. Em seguida o portal envia a senha ao servidor do portal, que confere de novo na ação `login` do
   servidor principal e cria um token próprio, válido por 12h, guardado no KV (`sess:<token>`). O token do
   servidor principal não é guardado nem devolvido por ele.
4. No servidor do portal, após 10 senhas erradas do mesmo IP, os logins ficam bloqueados por 15 minutos.

O navegador guarda os dois tokens só nesta aba (`hliving_token` e `hliving_portal_token`), mais a hora do
login (`hliving_admin_em`). Depois de 11h, ou pelo botão **Sair**, o Admin volta a pedir a senha. Se a
senha mudar no painel das tabelas (inclusive pela recuperação de senha), muda aqui também.

## Endpoints

| Chamada | Resposta |
| --- | --- |
| `GET ?action=getPortal` | `{ "v": 1, "devs": { … }, "em": "<data da última gravação>" }` |
| `POST { "action": "login", "data": { "senha": "…" } }` | `{ ok: true, token }` · `{ ok: false }` · `{ ok: false, error: "tentativas" }` (429) · `{ ok: false, error: "upstream" }` (502, servidor principal fora do ar) |
| `POST { "action": "savePortal", "token": "…", "data": { "id": "tekoa", "dev": { … } } }` | `{ ok: true }` · `{ error: "auth" }` (token ausente ou vencido) · `{ ok: false, error: "<motivo>" }` |

- `dev: null` apaga a edição daquele empreendimento (botão *Restaurar original*).
- O CORS só libera `https://hliving-dashboard.vercel.app` e `https://tabelas.hliving.com.br`.
- Tudo fica numa única chave do KV, `portal`, e cada gravação troca um empreendimento por vez.

## O que é guardado (`devs.<id>`)

Só o que mudou em relação ao que está escrito no portal (`index.html`). Os ids são os do portal: `c254`,
`atl`, `altos`, `flats`, `duetto`, `tropical`, `haute`, `lafayette`, `costamare`, `tekoa`, `villa`,
`cota`.

| Campo | Tipo | Regra |
| --- | --- | --- |
| `resumo` | texto | título do card, até 140 caracteres |
| `detalhe` | texto | descrição, até 420 |
| `entrega` | texto | até 60 |
| `badge` | texto | selo da capa, até 28 |
| `capa` | id | id de uma foto do empreendimento (ou de uma adicionada) |
| `pos` | texto | `center N%`, com N de 0 a 100 |
| `ocultar` | lista de ids | fotos, vídeos, plantas, catálogo, ou `u:<unidade>` para a galeria inteira de uma unidade; até 500 |
| `add` | objeto | `fotos`, `videos`, `plantas`, `docs`: listas de `"<id do Drive>\|<legenda>"`, até 100 cada |

O servidor valida tudo isso, tirando `<` e `>`. O portal valida de novo antes de exibir.

## Como o portal usa

- Ao abrir, o portal busca os preços no servidor principal (`getAll`) e as edições no servidor do portal
  (`getPortal`), cada um por conta própria: se um cair, o outro continua valendo.
- Depois do login, o **Admin** mostra duas opções: *Preços, unidades e CUB* e o editor. Se o servidor do
  portal não responder, só a primeira aparece, com um aviso, e o portal mostra o que está escrito no
  portal (`index.html`).
- *Preços, unidades e CUB* é o próprio `hliving-tabelas.html#admin`, aberto numa janela dentro do portal:
  mesma senha, mesmas telas e mesmas gravações no servidor principal. Ao fechar, se algo foi salvo lá,
  o portal recarrega para mostrar os preços e o CUB novos. Ctrl/Cmd+clique no Admin abre o painel numa
  aba própria.
- O KV leva até 1 minuto para espalhar uma gravação pelo mundo. O navegador que publicou usa o que
  acabou de publicar por 2 minutos (`sessionStorage`, chave `portal_recem`).

## Manutenção

**Atualizar o código do servidor.** Cloudflare (conta Marketing) → Workers & Pages → `hliving-portal` →
*Edit code* → colar o conteúdo de `servidor-portal/worker.js` → *Deploy*. Depois, guardar a mesma
versão aqui no repositório.

**Voltar uma versão.** Aba *Deployments* do Worker → versão anterior → *Rollback*.

**Ver ou copiar as edições salvas.** Abrir `https://hliving-portal.bold-resonance-24f8.workers.dev/?action=getPortal`,
ou ir em Storage & databases → Workers KV → `hliving-portal` → chave `portal`.

**Desligar o editor.** Escolha um dos dois:

- No portal (`index.html`), apagar a linha `carregarPortal();`.
- Na Cloudflare, desativar o endereço `workers.dev` do Worker (Settings → Domains & Routes).

Nos dois casos o editor some do Admin e o portal volta a mostrar só o que está no `index.html`. As
edições continuam guardadas no KV.

**Limites do plano gratuito do KV.** São 100 mil leituras e mil gravações por dia. Cada visita ao
portal faz 1 leitura. Cada publicação, login ou senha errada faz 1 gravação.

## Se um dia for juntar com o servidor principal

Basta levar `getPortal` e `savePortal` para o Worker do servidor principal, usando a checagem de token
que ele já tem, e copiar o valor da chave `portal`. Depois, trocar `PORTAL_API` no `index.html`.

## Teste rápido

1. Portal → **Admin** → senha do painel das tabelas → aparecem as duas opções.
2. *Preços, unidades e CUB* abre o painel das tabelas já logado.
3. *Textos, capas e fotos do portal*: mudar o título de um empreendimento → **Salvar e publicar**. A página
   recarrega, o editor reabre com *Publicado* e o card mostra o título novo.
4. **Restaurar original** → **Salvar e publicar**. O card volta ao texto do `index.html`.
