const TG_API = "https://api.telegram.org/bot";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {"content-type": "application/json; charset=utf-8"}
  });
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    "raw", keyBytes, {name:"HMAC", hash:"SHA-256"}, false, ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

function hex(bytes) {
  return [...bytes].map(b=>b.toString(16).padStart(2,"0")).join("");
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get("hash");
  if (!hash) return null;
  p.delete("hash");

  const pairs = [...p.entries()].sort(([a],[b])=>a.localeCompare(b))
    .map(([k,v])=>`${k}=${v}`).join("\n");

  const secretKey = await hmac(new TextEncoder().encode("WebAppData"), botToken);
  const secretHex = hex(secretKey);
  const calc = await hmac(new TextEncoder().encode(secretHex), pairs);

  if (hex(calc) !== hash) return null;

  const authDate = Number(p.get("auth_date") || 0);
  if (!authDate || Date.now()/1000 - authDate > 86400) return null;

  try { return JSON.parse(p.get("user") || "null"); } catch { return null; }
}

async function requireUser(request, env) {
  const initData = request.headers.get("X-Telegram-Init-Data");
  const tgUser = await validateInitData(initData, env.BOT_TOKEN);
  if (!tgUser?.id) return null;

  const row = await env.DB.prepare(
    "SELECT * FROM users WHERE telegram_id=? AND is_active=1"
  ).bind(String(tgUser.id)).first();

  return { tgUser, row };
}

async function tgSend(env, method, body) {
  const r = await fetch(`${TG_API}${env.BOT_TOKEN}/${method}`, {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  return r.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/me") {
      const u = await requireUser(request, env);
      if (!u) return json({ok:false, error:"LOGIN_REQUIRED"}, 401);
      return json({ok:true, user:u.row, telegram:u.tgUser});
    }

    if (request.method === "POST" && url.pathname === "/api/register") {
      const u = await requireUser(request, env);
      if (!u) return json({ok:false,error:"TELEGRAM_AUTH_REQUIRED"},401);
      const body = await request.json();
      const name = String(body.name||"").trim();
      const phone = String(body.phone||"").trim();
      const email = String(body.email||"").trim();
      if (!name || !phone) return json({ok:false,error:"NAME_AND_PHONE_REQUIRED"},400);

      await env.DB.prepare(`
        INSERT INTO users(telegram_id,telegram_username,name,phone,email,is_verified)
        VALUES(?,?,?,?,?,1)
        ON CONFLICT(telegram_id) DO UPDATE SET
          telegram_username=excluded.telegram_username,
          name=excluded.name, phone=excluded.phone, email=excluded.email
      `).bind(
        String(u.tgUser.id), u.tgUser.username||null, name, phone, email||null
      ).run();

      return json({ok:true});
    }

    if (request.method === "GET" && url.pathname === "/api/search") {
      const u = await requireUser(request, env);
      if (!u?.row) return json({ok:false,error:"LOGIN_REQUIRED"},401);
      const q = (url.searchParams.get("q")||"").trim();
      if (q.length < 2) return json({ok:true,albums:[],songs:[]});

      const songs = await env.DB.prepare(`
        SELECT s.*, a.name AS album_name
        FROM songs s LEFT JOIN albums a ON a.id=s.album_id
        WHERE s.name LIKE ? OR a.name LIKE ?
        ORDER BY s.name LIMIT 50
      `).bind(`%${q}%`,`%${q}%`).all();

      const albums = await env.DB.prepare(`
        SELECT * FROM albums WHERE name LIKE ? ORDER BY name LIMIT 30
      `).bind(`%${q}%`).all();

      return json({ok:true,albums:albums.results,songs:songs.results});
    }

    if (request.method === "POST" && url.pathname === "/api/song/access") {
      const u = await requireUser(request, env);
      if (!u?.row) return json({ok:false,error:"LOGIN_REQUIRED"},401);
      const {songId} = await request.json();
      const song = await env.DB.prepare("SELECT * FROM songs WHERE id=?")
        .bind(Number(songId)).first();
      if (!song?.telegram_file_id) return json({ok:false,error:"SONG_NOT_CONFIGURED"},404);

      await env.DB.prepare(
        "INSERT INTO access_logs(user_id,song_id,action) VALUES(?,?,?)"
      ).bind(u.row.id, song.id, "telegram_send").run();

      const result = await tgSend(env, "sendAudio", {
        chat_id: u.tgUser.id,
        audio: song.telegram_file_id,
        caption: `${song.name}${song.album_name ? "\nAlbum: "+song.album_name : ""}`
      });
      return json({ok:!!result.ok, telegram:result.ok ? undefined : result});
    }

    if (request.method === "POST" && url.pathname === "/api/admin/song") {
      const secret = request.headers.get("X-Admin-Secret");
      if (!secret || secret !== env.ADMIN_SECRET) return json({ok:false},403);
      const b = await request.json();
      await env.DB.prepare(`
        INSERT INTO songs(album_id,name,year,telegram_chat_id,telegram_message_id,telegram_file_id,file_name)
        VALUES(?,?,?,?,?,?,?)
      `).bind(
        b.album_id||null,b.name,b.year||null,b.telegram_chat_id||null,
        b.telegram_message_id||null,b.telegram_file_id||null,b.file_name||null
      ).run();
      return json({ok:true});
    }

    return env.ASSETS.fetch(request);
  }
};
