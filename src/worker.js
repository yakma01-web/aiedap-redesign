// Worker for the training page: serves the static site and the shared data API. One table: kv(k, v, t).
//   et:<uid>            evaluation type chosen (t | s | b)
//   cr:<uid>            {"sub": "...", "text": "..."}  assessment criterion per subject
//   fb:<group>:<i>:<uid> feedback text for member i of a group
//   pv:<group>          {"v","idx","sk","cur","ph","t0"}  whose turn it is in a group
//   admin               sha-256 of the instructor key
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const int = (x, lo, hi, d) => { const n = Number(x); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d; };

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
async function isAdmin(db, key) {
  if (!key) return false;
  const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('admin').first();
  return !!row && row.v === await sha(key);
}
const UP = 'INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t';

async function api(request, env) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/^\/api\/?/, '');
  const db = env.DB;
  if (!db) return J({ error: 'database is not connected' }, 500);
  const now = Date.now();
  try {
    if (p === 'put' && request.method === 'POST') {
      let b;
      try { b = await request.json(); } catch (e) { return J({ error: 'bad json' }, 400); }
      const k = String((b && b.k) || '');
      if (/^et:[0-9a-f]{1,8}$/.test(k)) {
        const v = String(b.v);
        if (!/^[tsb]$/.test(v)) return J({ error: 'bad value' }, 400);
        await db.prepare(UP).bind(k, v, now).run();
        return J({ ok: 1 });
      }
      if (/^cr:[0-9a-f]{1,8}$/.test(k)) {
        let o;
        try { o = JSON.parse(String(b.v)); } catch (e) { return J({ error: 'bad value' }, 400); }
        if (!o || !/^(soc|his|geo|eth)$/.test(o.sub)) return J({ error: 'bad value' }, 400);
        await db.prepare(UP).bind(k, JSON.stringify({ sub: o.sub, text: String(o.text || '').slice(0, 1000) }), now).run();
        return J({ ok: 1 });
      }
      if (/^fb:\d{1,2}:\d{1,2}:[0-9a-f]{1,8}$/.test(k)) {
        const v = String(b.v == null ? '' : b.v).slice(0, 2000);
        if (!v.trim()) await db.prepare('DELETE FROM kv WHERE k = ?').bind(k).run();
        else await db.prepare(UP).bind(k, v, now).run();
        return J({ ok: 1 });
      }
      if (/^pv:\d{1,2}$/.test(k)) {
        const o = b.v || {};
        const v = {
          v: int(o.v, 0, 1e9, 0), idx: int(o.idx, 0, 20, 0), cur: int(o.cur, -1, 20, -1),
          sk: Array.isArray(o.sk) ? o.sk.slice(0, 20).map((x) => int(x, 0, 20, 0)) : [],
          ph: /^(idle|talk|fb)$/.test(o.ph) ? o.ph : 'idle', t0: int(o.t0, 0, 1e14, 0)
        };
        await db.prepare("INSERT INTO kv (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t WHERE CAST(json_extract(excluded.v, '$.v') AS INTEGER) > CAST(json_extract(kv.v, '$.v') AS INTEGER)").bind(k, JSON.stringify(v), now).run();
        const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind(k).first();
        return J({ ok: 1, now: now, pv: row ? JSON.parse(row.v) : null });
      }
      return J({ error: 'bad key' }, 400);
    }

    if (p === 'get') {
      const q = url.searchParams;
      const out = { now: now };
      if (q.get('et')) {
        const r = await db.prepare("SELECT v, COUNT(*) AS n FROM kv WHERE k LIKE 'et:%' GROUP BY v").all();
        out.et = { t: 0, s: 0, b: 0 };
        (r.results || []).forEach((x) => { if (x.v in out.et) out.et[x.v] = x.n; });
      }
      const sub = q.get('cr');
      if (sub && /^(soc|his|geo|eth)$/.test(sub)) {
        const r = await db.prepare("SELECT v FROM kv WHERE k LIKE 'cr:%' LIMIT 400").all();
        out.cr = [];
        (r.results || []).forEach((x) => { try { const o = JSON.parse(x.v); if (o.sub === sub && o.text) out.cr.push(o.text); } catch (e) {} });
      }
      const g = q.get('pv');
      if (g && /^\d{1,2}$/.test(g)) {
        const row = await db.prepare('SELECT v FROM kv WHERE k = ?').bind('pv:' + g).first();
        out.pv = row ? JSON.parse(row.v) : null;
      }
      const fb = q.get('fb');
      const m = fb && /^(\d{1,2}):(all|\d{1,2}(?:,\d{1,2})*)$/.exec(fb);
      if (m) {
        const r = await db.prepare('SELECT k, v FROM kv WHERE k LIKE ? ORDER BY t').bind('fb:' + m[1] + ':%').all();
        const want = m[2] === 'all' ? null : m[2].split(',').map(Number);
        out.fb = [];
        (r.results || []).forEach((x) => { const s = x.k.split(':'); const i = Number(s[2]); if (!want || want.indexOf(i) >= 0) out.fb.push({ i: i, u: s[3], text: x.v }); });
      }
      return J(out);
    }

    if (p === 'admin') {
      if (request.method === 'POST') {
        let b;
        try { b = await request.json(); } catch (e) { return J({ error: 'bad json' }, 400); }
        if (!(await isAdmin(db, b && b.key))) return J({ error: 'wrong key' }, 403);
        if (b.action === 'clear') { await db.prepare("DELETE FROM kv WHERE k != 'admin'").run(); return J({ ok: 1 }); }
        return J({ error: 'bad action' }, 400);
      }
      if (!(await isAdmin(db, url.searchParams.get('key')))) return J({ error: 'wrong key' }, 403);
      const r = await db.prepare("SELECT k, v, t FROM kv WHERE k != 'admin' ORDER BY k").all();
      return J({ now: now, rows: r.results || [] });
    }
    return J({ error: 'not found' }, 404);
  } catch (e) {
    return J({ error: String((e && e.message) || e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0) return api(request, env);
    return env.ASSETS.fetch(request);
  }
};
