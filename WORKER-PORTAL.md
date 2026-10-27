# Edição do portal pelo Admin — ajuste no Worker

O `portal.html` já tem um editor de **textos, capa, enquadramento e mídia** dos cards. Ele fica
desligado até o Worker (`hliving-proxy.jefearq.workers.dev`) suportar duas coisas:

1. o campo `portal` na resposta do `getAll`;
2. a ação `savePortal` no POST.

Assim que o `getAll` passar a trazer `portal`, o botão **Admin** do portal mostra a opção
*Textos, capas e fotos do portal*. Nada mais precisa mudar no site.

O login é o mesmo do painel das tabelas: o portal chama a ação `login` que já existe e usa o
token devolvido. Nenhuma senha fica no repositório.

## Contrato

### `GET ?action=getAll` — incluir `portal`

```json
{
  "empreendimento": { "...": "como hoje" },
  "portal": {
    "v": 1,
    "devs": {
      "tekoa": {
        "resumo": "Seis unidades repassadas no TEKOÁ, frente mar",
        "capa": "1O3HDTi3ZT2r2V8F9FddOPeNQk7BqX5Ux",
        "pos": "center 20%",
        "ocultar": ["1_NZ4DHmLOLO4g7FUuvpcBh0A7BQkwu4d", "u:701"],
        "add": { "fotos": ["1AbCdEfGhIjKlMnOpQrStUvWxYz012345|Fachada 04"] }
      }
    }
  }
}
```

- A **presença da chave** `portal` é o que liga o editor. Sem nada salvo, devolva `"portal": { "v": 1, "devs": {} }`.
- Cada empreendimento guarda **só o que mudou** em relação ao que está escrito no `portal.html`.
- As chaves de `devs` são os ids do portal: `c254`, `atl`, `altos`, `flats`, `duetto`, `tropical`,
  `haute`, `lafayette`, `costamare`, `tekoa`, `villa`, `cota`.

### `POST` — ação `savePortal`

Mesmo formato das outras gravações:

```json
{ "action": "savePortal", "token": "<token do login>", "data": { "id": "tekoa", "dev": { "...": "..." } } }
```

- `dev: null` = apagar a edição daquele empreendimento (botão *Restaurar original*).
- Respostas: `{ "ok": true }` · `{ "error": "auth" }` (token ausente ou expirado — o portal pede login de novo) · `{ "ok": false, "error": "<motivo>" }`.
- Salva **um empreendimento por vez**, então duas pessoas editando empreendimentos diferentes não se sobrescrevem.

## Campos de `dev`

| Campo | Tipo | Regra |
| --- | --- | --- |
| `resumo` | texto | título do card, até 140 caracteres |
| `detalhe` | texto | descrição, até 420 |
| `entrega` | texto | até 60 |
| `badge` | texto | selo da capa, até 28 |
| `capa` | id | id de uma foto que já existe no empreendimento (ou adicionada) |
| `pos` | texto | `center N%`, N de 0 a 100 |
| `ocultar` | lista de ids | fotos, vídeos, plantas, catálogo, ou `u:<unidade>` para a galeria inteira de uma unidade; até 500 |
| `add` | objeto | `fotos`, `videos`, `plantas`, `docs`: listas de `"<id do Drive>\|<legenda>"`, até 100 cada |

O portal já valida tudo isso antes de enviar e de novo antes de exibir (incluindo tirar `<` e `>`),
mas o Worker **deve validar também** — o cliente não é confiável.

## Código de referência

Escrito para Cloudflare Workers com KV (`env.HLIVING_KV`). Se as gravações de hoje vão para a
planilha (Apps Script), a lógica é a mesma: uma aba `portal` com uma linha por empreendimento
(`id`, `json`, `atualizadoEm`). Uma linha por empreendimento também fica longe do limite de
50.000 caracteres por célula do Google Sheets.

`tokenValido` e `json` são marcadores: use **a mesma checagem de token e a mesma resposta** que as
outras ações de gravação já usam.

```js
// ---- Portal do Corretor: textos, capas e mídia ----
const PORTAL_ID = /^[a-z0-9_]{2,32}$/;
const PORTAL_TXT = { resumo: 140, detalhe: 420, entrega: 60, badge: 28 };
const PORTAL_TIPOS = ['fotos', 'videos', 'plantas', 'docs'];
const PORTAL_REF = /^[A-Za-z0-9_\-\/.:]{2,120}$/;            // ids do Drive, v-..., f/..., u:<unidade>
const PORTAL_ITEM = /^[A-Za-z0-9_-]{20,80}\|[^|<>]{1,80}$/;  // "<id do Drive>|<legenda>"
const limpa = (v, max) => typeof v === 'string'
  ? v.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) : '';

function validaPortalDev(dev) {
  if (dev === null) return null;
  if (!dev || typeof dev !== 'object' || Array.isArray(dev)) throw new Error('dev');
  if (JSON.stringify(dev).length > 50000) throw new Error('tamanho');
  const out = {};
  for (const k of Object.keys(PORTAL_TXT)) { const v = limpa(dev[k], PORTAL_TXT[k]); if (v) out[k] = v; }
  if (typeof dev.capa === 'string' && PORTAL_REF.test(dev.capa) && !dev.capa.startsWith('u:')) out.capa = dev.capa;
  const p = typeof dev.pos === 'string' && /^center (\d{1,3})%$/.exec(dev.pos);
  if (p && +p[1] <= 100) out.pos = dev.pos;
  if (Array.isArray(dev.ocultar)) {
    const oc = dev.ocultar.filter(x => typeof x === 'string' && PORTAL_REF.test(x)).slice(0, 500);
    if (oc.length) out.ocultar = oc;
  }
  if (dev.add && typeof dev.add === 'object') {
    const add = {};
    for (const t of PORTAL_TIPOS) {
      const l = (Array.isArray(dev.add[t]) ? dev.add[t] : []).filter(s => typeof s === 'string' && PORTAL_ITEM.test(s)).slice(0, 100);
      if (l.length) add[t] = l;
    }
    if (Object.keys(add).length) out.add = add;
  }
  return Object.keys(out).length ? out : null;
}

// No roteador de POST, junto das outras ações:
if (action === 'savePortal') {
  if (!(await tokenValido(body.token, env))) return json({ error: 'auth' });
  const id = body.data && body.data.id;
  if (typeof id !== 'string' || !PORTAL_ID.test(id)) return json({ ok: false, error: 'id' });
  let dev;
  try { dev = validaPortalDev(body.data.dev); } catch (e) { return json({ ok: false, error: e.message }); }
  if (dev) await env.HLIVING_KV.put('portal:' + id, JSON.stringify(dev));
  else await env.HLIVING_KV.delete('portal:' + id);
  return json({ ok: true });
}

// No getAll, junto dos outros campos da resposta:
const devs = {};
for (const k of (await env.HLIVING_KV.list({ prefix: 'portal:' })).keys) {
  const v = await env.HLIVING_KV.get(k.name);
  if (v) devs[k.name.slice('portal:'.length)] = JSON.parse(v);
}
resposta.portal = { v: 1, devs };
```

Se o Worker restringe as origens no CORS, o portal grava das mesmas origens que o painel das
tabelas (`hliving-dashboard.vercel.app` e `tabelas.hliving.com.br`).

## Como testar depois de publicar

1. Abrir o portal → **Admin**. Devem aparecer duas opções; a segunda é *Textos, capas e fotos do portal*.
2. Entrar com a senha do painel das tabelas.
3. Escolher um empreendimento, mudar o título e clicar em **Salvar e publicar**. A página recarrega
   e o editor reabre com *Publicado*; o card já mostra o título novo para qualquer visitante.
4. **Restaurar original** + **Salvar e publicar** apaga a edição e o card volta ao texto do `portal.html`.

## Como desligar

Tirar `portal` da resposta do `getAll`. O editor some e o portal volta a mostrar só o que está
escrito no `portal.html`. As edições salvas continuam guardadas no Worker.
