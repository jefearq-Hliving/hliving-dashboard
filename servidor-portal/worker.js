// HLiving — servidor do editor do Portal do Corretor (Cloudflare, conta Marketing: worker "hliving-portal").
// Guarda só as edições do portal (textos, capa, enquadramento, mídia) num KV próprio (binding PORTAL_KV).
// A senha é conferida pelo servidor principal (hliving-proxy.jefearq), do mesmo jeito que o login do painel
// das tabelas. Aqui não existe senha nenhuma: só sessões aleatórias de 12h guardadas no KV.

const UPSTREAM = 'https://hliving-proxy.jefearq.workers.dev';
const ORIGENS = ['https://hliving-dashboard.vercel.app', 'https://tabelas.hliving.com.br'];
const SESSAO_TTL = 12 * 60 * 60;            // 12h, igual ao painel das tabelas
const LOGIN_JANELA = 15 * 60;               // tentativas erradas contam por 15 min
const LOGIN_MAX = 10;                       // por IP, dentro da janela

const PORTAL_ID = /^[a-z0-9_]{2,32}$/;
const PORTAL_TXT = { resumo: 140, detalhe: 420, entrega: 60, badge: 28 };
const PORTAL_TIPOS = ['fotos', 'videos', 'plantas', 'docs'];
const PORTAL_REF = /^[A-Za-z0-9_\-\/.:]{2,120}$/;            // ids do Drive, v-..., f/..., u:<unidade>
const PORTAL_ITEM = /^[A-Za-z0-9_-]{20,80}\|[^|<>]{1,80}$/;  // "<id do Drive>|<legenda>"
const TOKEN = /^[0-9a-f-]{60,80}$/;

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
      const l = (Array.isArray(dev.add[t]) ? dev.add[t] : [])
        .filter(s => typeof s === 'string' && PORTAL_ITEM.test(s)).slice(0, 100);
      if (l.length) add[t] = l;
    }
    if (Object.keys(add).length) out.add = add;
  }
  return Object.keys(out).length ? out : null;
}

function cors(req) {
  const o = req.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (o && ORIGENS.includes(o)) {
    h['Access-Control-Allow-Origin'] = o;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}
const json = (req, obj, status = 200) => new Response(JSON.stringify(obj), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(req) } });

async function lerPortal(env) {
  const v = await env.PORTAL_KV.get('portal');
  if (!v) return { v: 1, devs: {} };
  try {
    const p = JSON.parse(v);
    return p && p.devs && typeof p.devs === 'object' ? p : { v: 1, devs: {} };
  } catch (e) { return { v: 1, devs: {} }; }
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    const url = new URL(req.url);

    if (req.method === 'GET') {
      if (url.searchParams.get('action') === 'getPortal') return json(req, await lerPortal(env));
      return json(req, { ok: true, servico: 'hliving-portal' });
    }
    if (req.method !== 'POST') return json(req, { ok: false, error: 'metodo' }, 405);

    let body;
    try { body = await req.json(); } catch (e) { return json(req, { ok: false, error: 'json' }, 400); }
    const action = body && body.action;

    if (action === 'login') {
      const chave = 'rl:' + (req.headers.get('CF-Connecting-IP') || 'sem-ip');
      const erros = parseInt((await env.PORTAL_KV.get(chave)) || '0', 10);
      if (erros >= LOGIN_MAX) return json(req, { ok: false, error: 'tentativas' }, 429);
      const senha = body.data && typeof body.data.senha === 'string' ? body.data.senha : '';
      if (!senha || senha.length > 200) return json(req, { ok: false });
      let ok = false, st = 0;
      try {
        const r = await fetch(UPSTREAM, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Origin': ORIGENS[0] },
          body: JSON.stringify({ action: 'login', data: { senha } })
        });
        st = r.status;
        const j = await r.json();
        ok = !!(j && j.ok && j.token);          // o token do servidor principal não é guardado nem devolvido
      } catch (e) {
        console.error('login: servidor principal não respondeu', st, String((e && e.message) || e));
        return json(req, { ok: false, error: 'upstream' }, 502);
      }
      if (!ok) {
        await env.PORTAL_KV.put(chave, String(erros + 1), { expirationTtl: LOGIN_JANELA });
        return json(req, { ok: false });
      }
      const token = crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
      await env.PORTAL_KV.put('sess:' + token, '1', { expirationTtl: SESSAO_TTL });
      return json(req, { ok: true, token });
    }

    if (action === 'savePortal') {
      const t = typeof body.token === 'string' && TOKEN.test(body.token) ? body.token : '';
      if (!t || !(await env.PORTAL_KV.get('sess:' + t))) return json(req, { error: 'auth' });
      const id = body.data && body.data.id;
      if (typeof id !== 'string' || !PORTAL_ID.test(id)) return json(req, { ok: false, error: 'id' });
      let dev;
      try { dev = validaPortalDev(body.data.dev); } catch (e) { return json(req, { ok: false, error: e.message }); }
      const p = await lerPortal(env);
      if (dev) p.devs[id] = dev; else delete p.devs[id];
      p.v = 1; p.em = new Date().toISOString();
      await env.PORTAL_KV.put('portal', JSON.stringify(p));
      return json(req, { ok: true });
    }

    return json(req, { ok: false, error: 'acao' }, 400);
  }
};
