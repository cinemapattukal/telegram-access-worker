var __defProp = Object.defineProperty;
var __name = (target, value) =>
  __defProp(target, "name", { value, configurable: true });

// ======================================================
// Telegram Access Worker
// ======================================================

var TG_API = "https://api.telegram.org/bot";

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

__name(json, "json");

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

__name(hmac, "hmac");

// ======================================================
// HEX
// ======================================================

function hex(bytes) {
  return [...bytes]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

__name(hex, "hex");

// ======================================================
// TELEGRAM MINI APP INIT DATA VALIDATION
// ======================================================

async function validateInitData(initData, botToken) {

  if (!initData || !botToken) {
    return null;
  }

  try {

    const p = new URLSearchParams(initData);

    const hash = p.get("hash");

    if (!hash) {
      return null;
    }

    p.delete("hash");

    const pairs = [...p.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("\n");

    // Telegram secret key
    const secretKey = await hmac(
      new TextEncoder().encode("WebAppData"),
      botToken
    );

    // IMPORTANT:
    // Use secretKey directly.
    // Do NOT convert it to HEX before HMAC.

    const calc = await hmac(
      secretKey,
      pairs
    );

    if (hex(calc) !== hash) {
      return null;
    }

    const authDate = Number(
      p.get("auth_date") || 0
    );

    if (!authDate) {
      return null;
    }

    // 24 hour validity
    if (
      Date.now() / 1000 - authDate > 86400
    ) {
      return null;
    }

    const userString = p.get("user");

    if (!userString) {
      return null;
    }

    return JSON.parse(userString);

  } catch (e) {

    console.error(
      "Telegram validation error:",
      e
    );

    return null;
  }
}

__name(validateInitData, "validateInitData");

// ======================================================
// REQUIRE TELEGRAM USER
// ======================================================

async function requireUser(request, env) {

  if (!env.DB) {
    return null;
  }

  if (!env.BOT_TOKEN) {
    return null;
  }

  const initData =
    request.headers.get(
      "X-Telegram-Init-Data"
    );

  const tgUser =
    await validateInitData(
      initData,
      env.BOT_TOKEN
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

__name(requireUser, "requireUser");

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

    const r = await fetch(
      `${TG_API}${env.BOT_TOKEN}/${method}`,
      {
        method: "POST",

        headers: {
          "content-type":
            "application/json"
        },

        body: JSON.stringify(body)
      }
    );

    return await r.json();

  } catch (e) {

    return {
      ok: false,
      error: String(e)
    };
  }
}

__name(tgSend, "tgSend");

// ======================================================
// WORKER
// ======================================================

var index_default = {

  async fetch(request, env) {

    try {

      const url =
        new URL(request.url);

      // ==================================================
      // HEALTH CHECK
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
            !!env.ASSETS

        });
      }

      // ==================================================
      // CURRENT USER
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/api/me"
      ) {

        const u =
          await requireUser(
            request,
            env
          );

        if (!u) {

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

          user:
            u.row,

          telegram:
            u.tgUser

        });
      }

      // ==================================================
      // REGISTER
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname === "/api/register"
      ) {

        const u =
          await requireUser(
            request,
            env
          );

        if (!u) {

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
              is_verified
            )
            VALUES(?,?,?,?,?,1)

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

              is_verified = 1
          `)
          .bind(

            String(
              u.tgUser.id
            ),

            u.tgUser.username ||
              null,

            name,

            phone,

            email || null

          )
          .run();

          return json({

            ok: true,

            message:
              "ACCOUNT_CREATED"

          });

        } catch (e) {

          return json(
            {
              ok: false,
              error:
                "DATABASE_ERROR",
              message:
                String(e)
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

        const u =
          await requireUser(
            request,
            env
          );

        if (!u?.row) {

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
            url.searchParams.get(
              "q"
            ) || ""
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
        url.pathname === "/api/song/access"
      ) {

        const u =
          await requireUser(
            request,
            env
          );

        if (!u?.row) {

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

        if (
          !song?.telegram_file_id
        ) {

          return json(
            {
              ok: false,
              error:
                "SONG_NOT_CONFIGURED"
            },
            404
          );
        }

        // Access log
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
            u.row.id,
            song.id,
            "telegram_send"
          )
          .run();

        } catch (e) {

          console.log(
            "Access log error:",
            e
          );
        }

        // Send audio through Telegram
        const result =
          await tgSend(
            env,
            "sendAudio",
            {

              chat_id:
                u.tgUser.id,

              audio:
                song.telegram_file_id,

              caption:
                `${song.name}${
                  song.album_name
                    ? "\nAlbum: " +
                      song.album_name
                    : ""
                }`

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
          ok: true
        });
      }

      // ==================================================
      // ADMIN ADD SONG
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname === "/api/admin/song"
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

        let b;

        try {

          b =
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

        if (!b.name) {

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

            b.album_id ||
              null,

            b.name,

            b.year ||
              null,

            b.telegram_chat_id ||
              null,

            b.telegram_message_id ||
              null,

            b.telegram_file_id ||
              null,

            b.file_name ||
              null

          )
          .run();

          return json({

            ok: true,

            message:
              "SONG_ADDED"

          });

        } catch (e) {

          return json(
            {
              ok: false,

              error:
                "DATABASE_ERROR",

              message:
                String(e)

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
      // FRONTEND / ASSETS
      // ==================================================

      if (
        env.ASSETS &&
        typeof env.ASSETS.fetch ===
          "function"
      ) {

        return env.ASSETS.fetch(
          request
        );
      }

      // No ASSETS binding
      return new Response(
        "Telegram Access Worker API is running.",
        {
          status: 200,

          headers: {
            "content-type":
              "text/plain; charset=utf-8"
          }
        }
      );

    } catch (error) {

      console.error(
        "Worker error:",
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

export {
  index_default as default
};
