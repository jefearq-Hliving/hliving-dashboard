# Servidor do editor do Portal do Corretor

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
Script e a planilha continuam iguais, e o portal nunca grava neles.

## Senha

É a mesma do painel das tabelas, e não fica escrita em lugar nenhum:

1. O editor envia a senha ao servidor do portal.
2. O servidor do portal repassa a senha para a ação `login` do servidor principal, a mesma checagem que
   o painel das tabelas usa. Se a senha mudar lá (inclusive pela recuperação de senha), muda aqui também.
3. Se estiver certa, o servidor do portal cria um token próprio, válido por 12h, e o guarda no KV
   (`sess:<token>`). O token do servidor principal não é guardado nem devolvido.
4. Após 10 senhas erradas do mesmo IP, os logins ficam bloqueados por 15 minutos.

O navegador guarda só o token do portal, em `sessionStorage` (`hliving_portal_token`). Esse nome é
diferente do token do painel das tabelas, para um não atrapalhar o outro.

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

Só o que mudou em relação ao que está escrito no `portal.html`. Os ids são os do portal: `c254`,
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
- Se o servidor do portal responder, o **Admin** mostra duas opções: o painel das tabelas e o editor.
  Se não responder, o Admin vai direto para o painel das tabelas e o portal mostra o que está escrito no
  `portal.html`.
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

- No `portal.html`, apagar a linha `carregarPortal();`.
- Na Cloudflare, desativar o endereço `workers.dev` do Worker (Settings → Domains & Routes).

Nos dois casos o editor some do Admin e o portal volta a mostrar só o que está no `portal.html`. As
edições continuam guardadas no KV.

**Limites do plano gratuito do KV.** São 100 mil leituras e mil gravações por dia. Cada visita ao
portal faz 1 leitura. Cada publicação, login ou senha errada faz 1 gravação.

## Se um dia for juntar com o servidor principal

Basta levar `getPortal` e `savePortal` para o Worker do servidor principal, usando a checagem de token
que ele já tem, e copiar o valor da chave `portal`. Depois, trocar `PORTAL_API` no `portal.html`.

## Teste rápido

1. Portal → **Admin** → *Textos, capas e fotos do portal* → senha do painel das tabelas.
2. Mudar o título de um empreendimento → **Salvar e publicar**. A página recarrega, o editor reabre com
   *Publicado* e o card mostra o título novo.
3. **Restaurar original** → **Salvar e publicar**. O card volta ao texto do `portal.html`.
