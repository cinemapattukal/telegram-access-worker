var __defProp = Object.defineProperty;
var __name = (target, value) =>
  __defProp(target, "name", {
    value,
    configurable: true
  });

// ======================================================
// TELEGRAM ACCESS WORKER
// D1 DATABASE + TELEGRAM BOT API
// NO ASSETS REQUIRED
// ======================================================

var TG_API = "https://api.telegram.org/bot";

// ======================================================
// JSON RESPONSE
// ======================================================

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control": "no-store"
      }
    }
  );
}

__name(json, "json");

// ======================================================
// HMAC SHA-256
// ======================================================

async function hmac(keyBytes, data) {

  const key =
    await crypto.subtle.importKey(
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
    .map((b) =>
      b.toString(16).padStart(2, "0")
    )
    .join("");
}

__name(hex, "hex");

// ======================================================
// TELEGRAM MINI APP INIT DATA VALIDATION
// ======================================================

async function validateInitData(
  initData,
  botToken
) {

  if (!initData || !botToken) {
    return null;
  }

  try {

    const params =
      new URLSearchParams(initData);

    const receivedHash =
      params.get("hash");

    if (!receivedHash) {
      return null;
    }

    // Remove hash before creating data-check-string
    params.delete("hash");

    // Sort alphabetically
    const dataCheckString =
      [...params.entries()]
        .sort(([a], [b]) =>
          a.localeCompare(b)
        )
        .map(
          ([key, value]) =>
            `${key}=${value}`
        )
        .join("\n");

    // --------------------------------------------------
    // Telegram secret key
    //
    // HMAC-SHA256
    // key  = bot token
    // data = WebAppData
    // --------------------------------------------------

    const secretKey =
      await hmac(
        new TextEncoder().encode(
          botToken
        ),
        "WebAppData"
      );

    // --------------------------------------------------
    // Calculate final hash
    //
    // key  = secretKey
    // data = dataCheckString
    // --------------------------------------------------

    const calculatedHash =
      await hmac(
        secretKey,
        dataCheckString
      );

    const calculatedHex =
      hex(calculatedHash);

    if (
      calculatedHex.toLowerCase() !==
      receivedHash.toLowerCase()
    ) {
      return null;
    }

    // --------------------------------------------------
    // Check auth_date
    // --------------------------------------------------

    const authDate =
      Number(
        params.get("auth_date") || 0
      );

    if (!authDate) {
      return null;
    }

    const now =
      Math.floor(
        Date.now() / 1000
      );

    // 24 hour validity
    if (
      now - authDate > 86400 ||
      authDate > now + 60
    ) {
      return null;
    }

    // --------------------------------------------------
    // Telegram user
    // --------------------------------------------------

    const userString =
      params.get("user");

    if (!userString) {
      return null;
    }

    const user =
      JSON.parse(userString);

    if (!user?.id) {
      return null;
    }

    return user;

  } catch (error) {

    console.error(
      "Telegram initData validation error:",
      error
    );

    return null;
  }
}

__name(
  validateInitData,
  "validateInitData"
);

// ======================================================
// REQUIRE TELEGRAM USER
// ======================================================

async function requireUser(
  request,
  env
) {

  if (!env.DB) {
    console.error(
      "D1 DB binding missing"
    );

    return null;
  }

  if (!env.BOT_TOKEN) {
    console.error(
      "BOT_TOKEN missing"
    );

    return null;
  }

  const initData =
    request.headers.get(
      "X-Telegram-Init-Data"
    );

  if (!initData) {
    return null;
  }

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
    .bind(
      String(tgUser.id)
    )
    .first();

  return {
    tgUser,
    row
  };
}

__name(
  requireUser,
  "requireUser"
);

// ======================================================
// TELEGRAM API
// ======================================================

async function tgSend(
  env,
  method,
  body
) {

  if (!env.BOT_TOKEN) {

    return {
      ok: false,
      error:
        "BOT_TOKEN_MISSING"
    };
  }

  try {

    const response =
      await fetch(
        `${TG_API}${env.BOT_TOKEN}/${method}`,
        {
          method: "POST",

          headers: {
            "content-type":
              "application/json"
          },

          body:
            JSON.stringify(body)
        }
      );

    const result =
      await response.json();

    return result;

  } catch (error) {

    console.error(
      "Telegram API error:",
      error
    );

    return {
      ok: false,
      error:
        String(error)
    };
  }
}

__name(
  tgSend,
  "tgSend"
);

// ======================================================
// WORKER
// ======================================================

var index_default = {

  async fetch(
    request,
    env
  ) {

    try {

      const url =
        new URL(
          request.url
        );

      // ==================================================
      // HEALTH CHECK
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname ===
          "/api/health"
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
            false
        });
      }

      // ==================================================
      // ROOT
      // ==================================================

      if (
        request.method === "GET" &&
        url.pathname === "/"
      ) {

        return json({
          ok: true,
          worker:
            "telegram-access-worker",
          message:
            "Telegram Access Worker is running.",
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
        url.pathname ===
          "/api/me"
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

          user:
            user.row,

          telegram:
            user.tgUser
        });
      }

      // ==================================================
      // REGISTER / CREATE ACCOUNT
      // ==================================================

      if (
        request.method === "POST" &&
        url.pathname ===
          "/api/register"
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

        if (
          !name ||
          !phone
        ) {

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
            VALUES(
              ?,
              ?,
              ?,
              ?,
              ?,
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

              is_verified = 1
          `)
          .bind(

            String(
              user.tgUser.id
            ),

            user.tgUser.username ||
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
            "Register DB error:",
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
        url.pathname ===
          "/api/search"
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
            url.searchParams.get(
              "q"
            ) || ""
          ).trim();

        if (
          q.length < 2
        ) {

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

        // ------------------------------------------------
        // Get song + album
        // ------------------------------------------------

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
          .bind(
            songId
          )
          .first();

        if (
          !song
        ) {

          return json(
            {
              ok: false,
              error:
                "SONG_NOT_FOUND"
            },
            404
          );
        }

        if (
          !song.telegram_file_id
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

        // ------------------------------------------------
        // Access log
        // ------------------------------------------------

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

          // Do not stop Telegram delivery
        }

        // ------------------------------------------------
        // Send audio to Telegram
        // ------------------------------------------------

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

        if (
          !result?.ok
        ) {

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

        if (
          !body.name
        ) {

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
      // NO ASSETS
      // ==================================================

      return new Response(
        "Telegram Access Worker is running.",
        {
          status: 200,

          headers: {
            "content-type":
              "text/plain; charset=utf-8",

            "cache-control":
              "no-store"
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

export {
  index_default as default
};
