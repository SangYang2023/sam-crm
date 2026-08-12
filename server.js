// 个人销售CRM · 同步后端
// 运行于 Render（Node.js Web Service，零依赖，纯 fetch 调用 Redis REST）
// 前端地址：https://<service>.onrender.com   ->  路由 /customers
const http = require('http');

const KEY = 'pet_crm_customers';

function envUrl(){ return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || ''; }
function envToken(){ return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''; }

async function rget(){
  const url = envUrl(), token = envToken();
  if(!url || !token) return null;
  try{
    const res = await fetch(`${url}/get/${KEY}`, { headers:{ 'Authorization':'Bearer '+token } });
    const j = await res.json();
    return j.result;
  }catch(e){ console.error('Redis get failed', e); return null; }
}
async function rset(val){
  const url = envUrl(), token = envToken();
  if(!url || !token) throw new Error('Redis 未配置');
  await fetch(`${url}/set/${KEY}`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer '+token },
    body: JSON.stringify(val)
  });
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
  if(!path.startsWith('/customers')){ res.writeHead(404, CORS); res.end('not found'); return; }
  if(req.method === 'OPTIONS'){ res.writeHead(204, CORS); res.end(); return; }

  // 鉴权：兼容 Authorization: Bearer 与 x-api-key 两种头
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
    send(res, 500, {error: String(e && e.message || e)});
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Pet CRM sync server listening on ' + PORT));
