// 个人销售CRM · 同步后端
// 运行于 Render（Node.js Web Service，零依赖，纯 fetch 调用 Redis REST）
const http = require('http');

const KEY = 'pet_crm_customers';

function envUrl(){ return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''; }
function envToken(){ return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''; }

async function rget(){
  const url = envUrl(), token = envToken();
  if(!url || !token) throw new Error('Redis 环境变量未配置');
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify(['GET', KEY])
    });
    if(!res.ok){
      const txt = await res.text().catch(()=>'');
      throw new Error(`Redis get failed: HTTP ${res.status} ${txt.slice(0,200)}`);
    }
    const j = await res.json();
    if(j.result === null || j.result === undefined) return [];
    try{ return JSON.parse(j.result); }catch(e){ return []; }
  }catch(e){
    const cause = e && e.cause && (e.cause.message || e.cause.code) ? ` (${e.cause.message || e.cause.code})` : '';
    throw new Error(`fetch failed: ${e.message||e}${cause}`);
  }
}
async function rset(val){
  const url = envUrl(), token = envToken();
  if(!url || !token) throw new Error('Redis 未配置');
  try{
    const res = await fetch(url, {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
      body: JSON.stringify(['SET', KEY, JSON.stringify(val)])
    });
    if(!res.ok){
      const txt = await res.text().catch(()=>'');
      throw new Error(`Redis set failed: HTTP ${res.status} ${txt.slice(0,200)}`);
    }
    return true;
  }catch(e){
    const cause = e && e.cause && (e.cause.message || e.cause.code) ? ` (${e.cause.message || e.cause.code})` : '';
    throw new Error(`fetch failed: ${e.message||e}${cause}`);
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization,x-api-key'
};

function send(res, status, body){
  res.writeHead(status, Object.assign({ 'Content-Type':'application/json' }, CORS));
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const path = u.pathname;
  if(path === '/health' || path === '/health/'){
    try{
      const list = await rget();
      send(res, 200, {ok:true, redis:true, records:Array.isArray(list)?list.length:0, time:new Date().toISOString()});
    }catch(e){
      send(res, 200, {ok:true, redis:false, error:String(e.message||e), time:new Date().toISOString()});
    }
    return;
  }
  if(!path.startsWith('/customers')){ res.writeHead(404, CORS); res.end('not found'); return; }
  if(req.method === 'OPTIONS'){ res.writeHead(204, CORS); res.end(); return; }

  const apiKey = process.env.API_KEY;
  if(apiKey){
    const auth = req.headers['authorization'] || '';
    const xkey = req.headers['x-api-key'] || '';
    if(auth !== 'Bearer ' + apiKey && xkey !== apiKey){ send(res, 401, {error:'unauthorized'}); return; }
  }

  try{
    if(req.method === 'GET'){
      const raw = await rget();
      const arr = Array.isArray(raw) ? raw : [];
      send(res, 200, arr);
      return;
    }

    if(req.method === 'POST'){
      let body = '';
      await new Promise(r => { req.on('data', c => body += c); req.on('end', r); });
      let c = null; try{ c = JSON.parse(body); }catch(e){}
      if(!c || !c.id){ send(res, 400, {error:'invalid'}); return; }
      let list = await rget();
      list = Array.isArray(list) ? list : [];
      const idx = list.findIndex(x => x.id === c.id);
      if(idx >= 0) list[idx] = c; else list.push(c);
      await rset(list);
      send(res, 200, {ok:true});
      return;
    }

    if(req.method === 'DELETE'){
      let id = path.split('/').pop();
      if(!id || id === 'customers') id = u.searchParams.get('id');
      let list = await rget();
      list = Array.isArray(list) ? list : [];
      list = list.filter(x => x.id !== id);
      await rset(list);
      send(res, 200, {ok:true});
      return;
    }

    send(res, 405, {error:'method not allowed'});
  }catch(e){
    console.error('handler error', e);
    send(res, 500, {error: String(e && e.message || e), hint:'请检查 Render Environment 中的 UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 是否正确'});
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('Pet CRM sync server listening on ' + PORT);
  (async()=>{
    try{
      const list = await rget();
      console.log('Redis self-test OK, records:', Array.isArray(list)?list.length:0);
    }catch(e){ console.error('Redis self-test failed', e); }
  })();
});
