var TG_API = "https://api.telegram.org/bot";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    {
      name: "HMAC",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );

  return new Uint8Array(
    await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(data)
    )
  );
}

function hex(bytes) {
  return [...bytes]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  try {
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash) return null;

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    const secretKey = await hmac(
      new TextEncoder().encode("WebAppData"),
      botToken
    );

    const calculatedHash = await hmac(
      secretKey,
      dataCheckString
    );

    if (
      hex(calculatedHash).toLowerCase() !==
      receivedHash.toLowerCase()
    ) {
      return null;
    }

    const authDate = Number(
      params.get("auth_date") || 0
    );

    const now = Math.floor(Date.now() / 1000);

    if (!authDate) return null;

    if (
      now - authDate > 86400 ||
      authDate > now + 60
    ) {
      return null;
    }

    const userString = params.get("user");

    if (!userString) return null;

    const user = JSON.parse(userString);

    if (!user?.id) return null;

    return user;

  } catch (error) {
    console.error(error);
    return null;
  }
}

async function getTelegramUser(request, env) {
  const initData =
    request.headers.get("X-Telegram-Init-Data");

  if (!initData) return null;
  if (!env.BOT_TOKEN) return null;

  return await validateInitData(
    initData,
    env.BOT_TOKEN
  );
}

async function requireUser(request, env) {
  const tgUser =
    await getTelegramUser(request, env);

  if (!tgUser?.id) return null;
  if (!env.DB) return null;

  const row = await env.DB.prepare(`
    SELECT *
    FROM users
    WHERE telegram_id = ?
    AND is_active = 1
  `)
    .bind(String(tgUser.id))
    .first();

  return {
    tgUser,
    row
  };
}

async function tgSend(env, method, body) {
  if (!env.BOT_TOKEN) {
    return {
      ok: false,
      error: "BOT_TOKEN_MISSING"
    };
  }

  try {
    const response = await fetch(
      `${TG_API}${env.BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body)
      }
    );

    return await response.json();

  } catch (error) {
    return {
      ok: false,
      error: String(error)
    };
  }
}

export default {

  async fetch(request, env) {

    try {

      const url = new URL(request.url);

      // -----------------------------------------------
      // HEALTH
      // -----------------------------------------------

      if (
        request.method === "GET" &&
        url.pathname === "/api/health"
      ) {
        return json({
          ok: true,
          worker: "telegram-access-worker",
          database: !!env.DB,
          botToken: !!env.BOT_TOKEN,
          adminSecret: !!env.ADMIN_SECRET
        });
      }

      // -----------------------------------------------
      // CURRENT USER
      // -----------------------------------------------

      if (
        request.method === "GET" &&
        url.pathname === "/api/me"
      ) {

        const user =
          await requireUser(request, env);

        if (!user) {
          return json({
            ok: false,
            error: "LOGIN_REQUIRED"
          }, 401);
        }

        return json({
          ok: true,
          user: user.row,
          telegram: user.tgUser
        });
      }

      // -----------------------------------------------
      // CREATE ACCOUNT
      // -----------------------------------------------

      if (
        request.method === "POST" &&
        url.pathname === "/api/register"
      ) {

        const user =
          await requireUser(request, env);

        if (!user) {
          return json({
            ok: false,
            error: "TELEGRAM_AUTH_REQUIRED"
          }, 401);
        }

        let body;

        try {
          body = await request.json();
        } catch {
          return json({
            ok: false,
            error: "INVALID_JSON"
          }, 400);
        }

        const name =
          String(body.name || "").trim();

        const phone =
          String(body.phone || "").trim();

        const email =
          String(body.email || "").trim();

        if (!name || !phone) {
          return json({
            ok: false,
            error: "NAME_AND_PHONE_REQUIRED"
          }, 400);
        }

        try {

          await env.DB.prepare(`
            INSERT INTO users(
              telegram_id,
              telegram_username,
              name,
              phone,
              email,
              is_verified,
              is_active
            )
            VALUES(?,?,?,?,?,1,1)

            ON CONFLICT(telegram_id)
            DO UPDATE SET

              telegram_username =
                excluded.telegram_username,

              name =
                excluded.name,

              phone =
                excluded.phone,

              email =
                excluded.email,

              is_verified = 1,

              is_active = 1
          `)
            .bind(
              String(user.tgUser.id),
              user.tgUser.username || null,
              name,
              phone,
              email || null
            )
            .run();

          return json({
            ok: true,
            message: "ACCOUNT_CREATED"
          });

        } catch (error) {

          return json({
            ok: false,
            error: "DATABASE_ERROR",
            message: String(error)
          }, 500);
        }
      }

      // -----------------------------------------------
      // SEARCH
      // -----------------------------------------------

      if (
        request.method === "GET" &&
        url.pathname === "/api/search"
      ) {

        const user =
          await requireUser(request, env);

        if (!user?.row) {
          return json({
            ok: false,
            error: "LOGIN_REQUIRED"
          }, 401);
        }

        const q =
          (url.searchParams.get("q") || "")
            .trim();

        if (q.length < 2) {
          return json({
            ok: true,
            albums: [],
            songs: []
          });
        }

        const songs =
          await env.DB.prepare(`
            SELECT
              s.*,
              a.name AS album_name
            FROM songs s
            LEFT JOIN albums a
              ON a.id = s.album_id
            WHERE
              s.name LIKE ?
              OR a.name LIKE ?
            ORDER BY s.name
            LIMIT 50
          `)
            .bind(`%${q}%`, `%${q}%`)
            .all();

        const albums =
          await env.DB.prepare(`
            SELECT *
            FROM albums
            WHERE name LIKE ?
            ORDER BY name
            LIMIT 30
          `)
            .bind(`%${q}%`)
            .all();

        return json({
          ok: true,
          albums: albums.results || [],
          songs: songs.results || []
        });
      }

      // -----------------------------------------------
      // SONG ACCESS
      // -----------------------------------------------

      if (
        request.method === "POST" &&
        url.pathname === "/api/song/access"
      ) {

        const user =
          await requireUser(request, env);

        if (!user?.row) {
          return json({
            ok: false,
            error: "LOGIN_REQUIRED"
          }, 401);
        }

        const body =
          await request.json();

        const songId =
          Number(body.songId);

        if (!songId) {
          return json({
            ok: false,
            error: "SONG_ID_REQUIRED"
          }, 400);
        }

        const song =
          await env.DB.prepare(`
            SELECT
              s.*,
              a.name AS album_name
            FROM songs s
            LEFT JOIN albums a
              ON a.id = s.album_id
            WHERE s.id = ?
          `)
            .bind(songId)
            .first();

        if (!song) {
          return json({
            ok: false,
            error: "SONG_NOT_FOUND"
          }, 404);
        }

        if (!song.telegram_file_id) {
          return json({
            ok: false,
            error: "SONG_NOT_CONFIGURED"
          }, 404);
        }

        try {
          await env.DB.prepare(`
            INSERT INTO access_logs(
              user_id,
              song_id,
              action
            )
            VALUES(?,?,?)
          `)
            .bind(
              user.row.id,
              song.id,
              "telegram_send"
            )
            .run();
        } catch {}

        const result =
          await tgSend(
            env,
            "sendAudio",
            {
              chat_id: user.tgUser.id,
              audio: song.telegram_file_id,
              caption:
                song.name +
                (
                  song.album_name
                    ? "\nAlbum: " +
                      song.album_name
                    : ""
                )
            }
          );

        if (!result?.ok) {
          return json({
            ok: false,
            error: "TELEGRAM_SEND_FAILED",
            telegram: result
          }, 500);
        }

        return json({
          ok: true,
          message: "SONG_SENT_TO_TELEGRAM"
        });
      }

      // -----------------------------------------------
      // ROOT
      // -----------------------------------------------

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {
        return new Response(
          "Telegram Access Worker is running.",
          {
            headers: {
              "content-type":
                "text/plain;charset=UTF-8"
            }
          }
        );
      }

      // -----------------------------------------------
      // UNKNOWN API
      // -----------------------------------------------

      if (url.pathname.startsWith("/api/")) {
        return json({
          ok: false,
          error: "API_ROUTE_NOT_FOUND"
        }, 404);
      }

      return new Response(
        "Telegram Access Worker is running."
      );

    } catch (error) {

      console.error(error);

      return json({
        ok: false,
        error: "INTERNAL_SERVER_ERROR",
        message: String(error)
      }, 500);
    }
  }
};
