const TG_API = "https://api.telegram.org/bot";

// ======================================================
// JSON RESPONSE
// ======================================================

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

// ======================================================
// HMAC SHA-256
// ======================================================

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

// ======================================================
// HEX
// ======================================================

function hex(bytes) {
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ======================================================
// TELEGRAM MINI APP INIT DATA VALIDATION
// ======================================================

async function validateInitData(initData, botToken) {
  if (!initData || !botToken) {
    return null;
  }

  try {
    const params = new URLSearchParams(initData);

    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return null;
    }

    params.delete("hash");

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    // Telegram WebAppData secret
    const secretKey = await hmac(
      new TextEncoder().encode(botToken),
      "WebAppData"
    );

    const calculatedHash = await hmac(
      secretKey,
      dataCheckString
    );

    const calculatedHex = hex(calculatedHash);

    if (
      calculatedHex.toLowerCase() !==
      receivedHash.toLowerCase()
    ) {
      console.error("Telegram hash mismatch");
      return null;
    }

    // ==================================================
    // AUTH DATE
    // ==================================================

    const authDate = Number(
      params.get("auth_date") || 0
    );

    if (!authDate) {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);

    // 24 hours
    if (
      now - authDate > 86400 ||
      authDate > now + 60
    ) {
      console.error("Telegram auth_date expired");
      return null;
    }

    // ==================================================
    // USER
    // ==================================================

    const userString = params.get("user");

    if (!userString) {
      return null;
    }

    const user = JSON.parse(userString);

    if (!user?.id) {
      return null;
    }

    return user;

  } catch (error) {
    console.error(
      "Telegram validation error:",
      error
    );

    return null;
  }
}

// ======================================================
// GET TELEGRAM USER
// ======================================================

async function getTelegramUser(request, env) {
  if (!env.BOT_TOKEN) {
    console.error("BOT_TOKEN missing");
    return null;
  }

  const initData =
    request.headers.get(
      "X-Telegram-Init-Data"
    );

  if (!initData) {
    return null;
  }

  return await validateInitData(
    initData,
    env.BOT_TOKEN
  );
}

// ======================================================
// REQUIRE TELEGRAM USER
// ======================================================

async function requireUser(request, env) {
  if (!env.DB) {
    console.error("D1 DB missing");
    return null;
  }

  const tgUser =
    await getTelegramUser(
      request,
      env
    );

  if (!tgUser?.id) {
    return null;
  }

  const row =
    await env.DB.prepare(`
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

// ======================================================
// TELEGRAM API
// ======================================================

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
    console.error(
      "Telegram API error:",
      error
    );

    return {
      ok: false,
      error: String(error)
    };
  }
}

// ======================================================
// WORKER
// ======================================================

export default {

  async fetch(request, env) {

    try {

      const url =
        new URL(request.url);

      // ==================================================
      // HEALTH
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/api/health"
      ) {

        return json({
          ok: true,

          worker:
            "telegram-access-worker",

          database:
            !!env.DB,

          botToken:
            !!env.BOT_TOKEN,

          adminSecret:
            !!env.ADMIN_SECRET,

          assets:
            !!env.ASSETS,

          botUsername:
            env.BOT_USERNAME || null
        });
      }

      // ==================================================
      // ROOT INFO
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/api"
      ) {

        return json({
          ok: true,

          worker:
            "telegram-access-worker",

          message:
            "Telegram Access Worker API",

          api: [
            "/api/health",
            "/api/me",
            "/api/register",
            "/api/search",
            "/api/song/access"
          ]
        });
      }

      // ==================================================
      // CURRENT USER
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/api/me"
      ) {

        const user =
          await requireUser(
            request,
            env
          );

        if (!user) {
          return json(
            {
              ok: false,
              error:
                "LOGIN_REQUIRED"
            },
            401
          );
        }

        return json({
          ok: true,

          registered:
            !!user.row,

          user:
            user.row,

          telegram:
            user.tgUser
        });
      }

      // ==================================================
      // REGISTER
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname === "/api/register"
      ) {

        const tgUser =
          await getTelegramUser(
            request,
            env
          );

        if (!tgUser) {
          return json(
            {
              ok: false,
              error:
                "TELEGRAM_AUTH_REQUIRED"
            },
            401
          );
        }

        let body;

        try {
          body =
            await request.json();
        } catch {
          return json(
            {
              ok: false,
              error:
                "INVALID_JSON"
            },
            400
          );
        }

        const name =
          String(
            body.name || ""
          ).trim();

        const phone =
          String(
            body.phone || ""
          ).trim();

        const email =
          String(
            body.email || ""
          ).trim();

        if (!name || !phone) {
          return json(
            {
              ok: false,
              error:
                "NAME_AND_PHONE_REQUIRED"
            },
            400
          );
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
            VALUES(
              ?,
              ?,
              ?,
              ?,
              ?,
              1,
              1
            )

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

            String(
              tgUser.id
            ),

            tgUser.username ||
              null,

            name,

            phone,

            email ||
              null

          )
          .run();

          return json({
            ok: true,
            message:
              "ACCOUNT_CREATED"
          });

        } catch (error) {

          console.error(
            "Register error:",
            error
          );

          return json(
            {
              ok: false,
              error:
                "DATABASE_ERROR",
              message:
                String(error)
            },
            500
          );
        }
      }

      // ==================================================
      // SEARCH
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/api/search"
      ) {

        const user =
          await requireUser(
            request,
            env
          );

        if (!user?.row) {
          return json(
            {
              ok: false,
              error:
                "LOGIN_REQUIRED"
            },
            401
          );
        }

        const q =
          (
            url.searchParams.get("q") ||
            ""
          ).trim();

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
          .bind(
            `%${q}%`,
            `%${q}%`
          )
          .all();

        const albums =
          await env.DB.prepare(`
            SELECT *
            FROM albums
            WHERE name LIKE ?
            ORDER BY name
            LIMIT 30
          `)
          .bind(
            `%${q}%`
          )
          .all();

        return json({
          ok: true,

          albums:
            albums.results || [],

          songs:
            songs.results || []
        });
      }

      // ==================================================
      // SONG ACCESS
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/song/access"
      ) {

        const user =
          await requireUser(
            request,
            env
          );

        if (!user?.row) {
          return json(
            {
              ok: false,
              error:
                "LOGIN_REQUIRED"
            },
            401
          );
        }

        let body;

        try {
          body =
            await request.json();
        } catch {
          return json(
            {
              ok: false,
              error:
                "INVALID_JSON"
            },
            400
          );
        }

        const songId =
          Number(
            body.songId
          );

        if (!songId) {
          return json(
            {
              ok: false,
              error:
                "SONG_ID_REQUIRED"
            },
            400
          );
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
          return json(
            {
              ok: false,
              error:
                "SONG_NOT_FOUND"
            },
            404
          );
        }

        if (!song.telegram_file_id) {
          return json(
            {
              ok: false,
              error:
                "SONG_NOT_CONFIGURED"
            },
            404
          );
        }

        // ==================================================
        // ACCESS LOG
        // ==================================================

        try {

          await env.DB.prepare(`
            INSERT INTO access_logs(
              user_id,
              song_id,
              action
            )
            VALUES(
              ?,
              ?,
              ?
            )
          `)
          .bind(
            user.row.id,
            song.id,
            "telegram_send"
          )
          .run();

        } catch (error) {

          console.error(
            "Access log error:",
            error
          );
        }

        // ==================================================
        // SEND AUDIO
        // ==================================================

        const caption =
          song.name +
          (
            song.album_name
              ? "\nAlbum: " +
                song.album_name
              : ""
          );

        const result =
          await tgSend(
            env,
            "sendAudio",
            {
              chat_id:
                user.tgUser.id,

              audio:
                song.telegram_file_id,

              caption:
                caption
            }
          );

        if (!result?.ok) {

          return json(
            {
              ok: false,

              error:
                "TELEGRAM_SEND_FAILED",

              telegram:
                result
            },
            500
          );
        }

        return json({
          ok: true,

          message:
            "SONG_SENT_TO_TELEGRAM"
        });
      }

      // ==================================================
      // ADMIN ADD SONG
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/admin/song"
      ) {

        const secret =
          request.headers.get(
            "X-Admin-Secret"
          );

        if (
          !secret ||
          !env.ADMIN_SECRET ||
          secret !==
            env.ADMIN_SECRET
        ) {

          return json(
            {
              ok: false,
              error:
                "ADMIN_UNAUTHORIZED"
            },
            403
          );
        }

        let body;

        try {
          body =
            await request.json();
        } catch {
          return json(
            {
              ok: false,
              error:
                "INVALID_JSON"
            },
            400
          );
        }

        if (!body.name) {
          return json(
            {
              ok: false,
              error:
                "SONG_NAME_REQUIRED"
            },
            400
          );
        }

        try {

          await env.DB.prepare(`
            INSERT INTO songs(
              album_id,
              name,
              year,
              telegram_chat_id,
              telegram_message_id,
              telegram_file_id,
              file_name
            )

            VALUES(
              ?,
              ?,
              ?,
              ?,
              ?,
              ?,
              ?
            )
          `)
          .bind(

            body.album_id ||
              null,

            String(
              body.name
            ).trim(),

            body.year ||
              null,

            body.telegram_chat_id ||
              null,

            body.telegram_message_id ||
              null,

            body.telegram_file_id ||
              null,

            body.file_name ||
              null

          )
          .run();

          return json({
            ok: true,
            message:
              "SONG_ADDED"
          });

        } catch (error) {

          console.error(
            "Admin add song error:",
            error
          );

          return json(
            {
              ok: false,
              error:
                "DATABASE_ERROR",
              message:
                String(error)
            },
            500
          );
        }
      }

      // ==================================================
      // API 404
      // ==================================================

      if (
        url.pathname.startsWith(
          "/api/"
        )
      ) {

        return json(
          {
            ok: false,
            error:
              "API_ROUTE_NOT_FOUND"
          },
          404
        );
      }

      // ==================================================
      // FRONTEND
      // ==================================================

      if (env.ASSETS) {
        return env.ASSETS.fetch(request);
      }

      return new Response(
        "ASSETS binding is missing.",
        {
          status: 500,
          headers: {
            "content-type":
              "text/plain; charset=utf-8"
          }
        }
      );

    } catch (error) {

      console.error(
        "Worker fatal error:",
        error
      );

      return json(
        {
          ok: false,
          error:
            "INTERNAL_SERVER_ERROR",
          message:
            String(error)
        },
        500
      );
    }
  }
};
