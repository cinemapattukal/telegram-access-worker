const TG_API = "https://api.telegram.org/bot";

/* =========================================================
   RESPONSE HELPERS
========================================================= */

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "Content-Type, X-Telegram-Init-Data",
      "access-control-allow-methods": "GET, POST, OPTIONS"
    }
  });
}

function html(content, status = 200) {
  return new Response(content, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

/* =========================================================
   HMAC
========================================================= */

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

/* =========================================================
   TELEGRAM INIT DATA VALIDATION
========================================================= */

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

    if (now - authDate > 86400) return null;

    if (authDate > now + 60) return null;

    const userString = params.get("user");

    if (!userString) return null;

    const user = JSON.parse(userString);

    if (!user?.id) return null;

    return user;

  } catch (error) {
    console.error("Telegram validation error:", error);
    return null;
  }
}

/* =========================================================
   GET TELEGRAM USER
========================================================= */

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

/* =========================================================
   GET USER + DATABASE RECORD
========================================================= */

async function getCurrentUser(request, env) {

  const tgUser =
    await getTelegramUser(request, env);

  if (!tgUser?.id) {
    return {
      tgUser: null,
      row: null
    };
  }

  if (!env.DB) {
    return {
      tgUser,
      row: null
    };
  }

  const row =
    await env.DB.prepare(`
      SELECT *
      FROM users
      WHERE telegram_id = ?
      LIMIT 1
    `)
      .bind(String(tgUser.id))
      .first();

  return {
    tgUser,
    row
  };
}

/* =========================================================
   REQUIRE ACTIVE USER
========================================================= */

async function requireUser(request, env) {

  const current =
    await getCurrentUser(request, env);

  if (!current.tgUser?.id) return null;

  if (!current.row) return null;

  if (Number(current.row.is_active) !== 1) {
    return null;
  }

  return current;
}

/* =========================================================
   TELEGRAM SEND
========================================================= */

async function tgSend(env, method, body) {

  if (!env.BOT_TOKEN) {
    return {
      ok: false,
      error: "BOT_TOKEN_MISSING"
    };
  }

  try {

    const response =
      await fetch(
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

/* =========================================================
   FRONTEND
========================================================= */

function appHTML() {

return `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
>

<title>A2Z Malayalam Songs</title>

<script src="https://telegram.org/js/telegram-web-app.js"></script>

<style>

* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  min-height: 100%;
  font-family:
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Arial,
    sans-serif;
  background: #f4f6fb;
  color: #111827;
}

body {
  padding: 18px;
}

.page {
  width: 100%;
  max-width: 720px;
  margin: auto;
}

.card {
  background: #ffffff;
  border-radius: 32px;
  padding: 42px 40px;
  box-shadow:
    0 15px 50px rgba(0,0,0,.07);
}

.logo {
  width: 166px;
  height: 166px;
  border-radius: 38px;
  background: #27a7dc;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 32px;
  color: #fff;
  font-size: 48px;
  font-weight: 800;
}

h1 {
  text-align: center;
  margin: 0;
  font-size: 48px;
  line-height: 1.15;
}

.subtitle {
  text-align: center;
  color: #737b87;
  font-size: 27px;
  margin-top: 20px;
}

.status {
  text-align: center;
  font-size: 25px;
  line-height: 1.35;
  margin: 55px 0 38px;
}

.status.connected {
  color: #111827;
}

.status.error {
  color: #dc2626;
}

.field {
  margin-bottom: 28px;
}

label {
  display: block;
  font-size: 25px;
  font-weight: 700;
  margin-bottom: 12px;
}

input {
  width: 100%;
  height: 82px;
  border: 1px solid #d7dce2;
  border-radius: 22px;
  padding: 0 28px;
  font-size: 24px;
  outline: none;
  background: #fff;
}

input:focus {
  border-color: #27a7dc;
  box-shadow: 0 0 0 3px rgba(39,167,220,.12);
}

button {
  width: 100%;
  height: 82px;
  border: 0;
  border-radius: 22px;
  background: #27a7dc;
  color: white;
  font-size: 25px;
  font-weight: 700;
  cursor: pointer;
}

button:disabled {
  opacity: .55;
}

.secondary {
  margin-top: 16px;
  background: #eef2f6;
  color: #111827;
}

.success {
  margin-top: 25px;
  padding: 20px;
  border-radius: 20px;
  background: #dcfce7;
  color: #166534;
  text-align: center;
  font-size: 22px;
}

.errorbox {
  margin-top: 25px;
  padding: 20px;
  border-radius: 20px;
  background: #fee2e2;
  color: #991b1b;
  text-align: center;
  font-size: 20px;
  word-break: break-word;
}

.dashboard {
  display: none;
}

.profile {
  text-align: center;
}

.avatar {
  width: 110px;
  height: 110px;
  border-radius: 50%;
  background: #27a7dc;
  color: white;
  margin: 0 auto 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 42px;
  font-weight: 800;
}

.profile h2 {
  margin: 0;
  font-size: 34px;
}

.profile p {
  color: #6b7280;
  font-size: 20px;
}

.search {
  margin-top: 35px;
}

.song {
  margin-top: 15px;
  padding: 18px;
  border: 1px solid #e5e7eb;
  border-radius: 18px;
}

.song-title {
  font-size: 20px;
  font-weight: 700;
}

.song-album {
  margin-top: 5px;
  color: #6b7280;
}

.song button {
  margin-top: 12px;
  height: 54px;
  font-size: 18px;
}

.small {
  font-size: 17px;
  color: #6b7280;
  text-align: center;
  margin-top: 20px;
}

@media (max-width: 600px) {

  body {
    padding: 0;
  }

  .page {
    max-width: none;
  }

  .card {
    min-height: calc(100vh - 0px);
    border-radius: 0;
    padding: 42px 38px;
  }

  .logo {
    width: 166px;
    height: 166px;
  }

  h1 {
    font-size: 43px;
  }

  .subtitle {
    font-size: 26px;
  }

  .status {
    font-size: 23px;
  }

  label {
    font-size: 23px;
  }

  input,
  button {
    height: 82px;
    font-size: 23px;
  }
}

</style>

</head>

<body>

<div class="page">

  <!-- CREATE / LOGIN -->

  <div class="card" id="authCard">

    <div class="logo">
      A2Z
    </div>

    <h1 id="pageTitle">
      Create Account
    </h1>

    <div class="subtitle">
      a2z Malayalam Songs
    </div>

    <div
      id="telegramStatus"
      class="status"
    >
      Connecting to Telegram...
    </div>

    <div id="formArea">

      <div class="field">
        <label>Name</label>

        <input
          id="name"
          type="text"
          placeholder="Enter your name"
          autocomplete="name"
        >
      </div>

      <div class="field">
        <label>Phone</label>

        <input
          id="phone"
          type="tel"
          placeholder="Enter phone number"
          autocomplete="tel"
        >
      </div>

      <div class="field">
        <label>Email</label>

        <input
          id="email"
          type="email"
          placeholder="Enter email"
          autocomplete="email"
        >
      </div>

      <button
        id="createBtn"
        onclick="createAccount()"
      >
        Create Account
      </button>

      <div id="message"></div>

    </div>

  </div>


  <!-- DASHBOARD -->

  <div
    class="card dashboard"
    id="dashboard"
  >

    <div class="profile">

      <div
        class="avatar"
        id="avatar"
      >
        A
      </div>

      <h2 id="userName">
        Account
      </h2>

      <p id="userInfo">
        Telegram account
      </p>

    </div>

    <div class="search">

      <input
        id="searchInput"
        type="search"
        placeholder="Search songs or albums..."
        oninput="searchSongs()"
      >

    </div>

    <div id="results"></div>

    <button
      class="secondary"
      onclick="logout()"
    >
      Logout
    </button>

  </div>

</div>


<script>

const tg =
  window.Telegram &&
  window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;

let initData = "";

let currentUser = null;


/* =========================================================
   TELEGRAM INIT
========================================================= */

function initTelegram() {

  if (!tg) {

    setStatus(
      "Open this page inside Telegram.",
      "error"
    );

    return false;
  }

  try {

    tg.ready();

    tg.expand();

  } catch (e) {}

  initData =
    tg.initData || "";

  if (!initData) {

    setStatus(
      "Telegram login data not available.",
      "error"
    );

    return false;
  }

  return true;
}


/* =========================================================
   API
========================================================= */

async function api(
  path,
  options = {}
) {

  const headers = {
    ...(options.headers || {})
  };

  if (initData) {
    headers["X-Telegram-Init-Data"] =
      initData;
  }

  if (
    options.body &&
    !headers["content-type"]
  ) {

    headers["content-type"] =
      "application/json";
  }

  const response =
    await fetch(
      path,
      {
        ...options,
        headers
      }
    );

  let data;

  try {
    data = await response.json();
  } catch {

    throw new Error(
      "Invalid server response"
    );
  }

  if (!response.ok) {

    throw new Error(
      data.message ||
      data.error ||
      "Request failed"
    );
  }

  return data;
}


/* =========================================================
   STATUS
========================================================= */

function setStatus(
  text,
  type = ""
) {

  const el =
    document.getElementById(
      "telegramStatus"
    );

  el.textContent = text;

  el.className =
    "status " + type;
}


/* =========================================================
   CHECK ACCOUNT
========================================================= */

async function checkAccount() {

  try {

    const result =
      await api("/api/me");

    if (
      result.ok &&
      result.user
    ) {

      currentUser =
        result.user;

      showDashboard();

      return;
    }

  } catch (error) {

    console.log(error);
  }

  showCreateForm();
}


/* =========================================================
   SHOW CREATE FORM
========================================================= */

function showCreateForm() {

  document
    .getElementById("authCard")
    .style.display = "block";

  document
    .getElementById("dashboard")
    .style.display = "none";

  document
    .getElementById("pageTitle")
    .textContent =
      "Create Account";

  setStatus(
    "Telegram account connected.",
    "connected"
  );
}


/* =========================================================
   CREATE ACCOUNT
========================================================= */

async function createAccount() {

  const btn =
    document.getElementById(
      "createBtn"
    );

  const message =
    document.getElementById(
      "message"
    );

  const name =
    document
      .getElementById("name")
      .value
      .trim();

  const phone =
    document
      .getElementById("phone")
      .value
      .trim();

  const email =
    document
      .getElementById("email")
      .value
      .trim();

  message.innerHTML = "";

  if (!name) {

    message.innerHTML =
      '<div class="errorbox">Please enter your name.</div>';

    return;
  }

  if (!phone) {

    message.innerHTML =
      '<div class="errorbox">Please enter your phone number.</div>';

    return;
  }

  btn.disabled = true;

  btn.textContent =
    "Creating Account...";

  try {

    const result =
      await api(
        "/api/register",
        {
          method: "POST",

          body: JSON.stringify({
            name,
            phone,
            email
          })
        }
      );

    if (result.ok) {

      message.innerHTML =
        '<div class="success">Account created successfully!</div>';

      btn.textContent =
        "Account Created";

      setTimeout(
        async () => {

          await checkAccount();

        },
        700
      );

    } else {

      throw new Error(
        result.error ||
        "Account creation failed"
      );
    }

  } catch (error) {

    message.innerHTML =
      '<div class="errorbox">' +
      escapeHTML(error.message) +
      '</div>';

    btn.disabled = false;

    btn.textContent =
      "Create Account";
  }
}


/* =========================================================
   DASHBOARD
========================================================= */

function showDashboard() {

  document
    .getElementById("authCard")
    .style.display = "none";

  document
    .getElementById("dashboard")
    .style.display = "block";

  const name =
    currentUser.name ||
    "User";

  document
    .getElementById("userName")
    .textContent =
      name;

  document
    .getElementById("userInfo")
    .textContent =
      currentUser.email ||
      currentUser.phone ||
      "Telegram account";

  document
    .getElementById("avatar")
    .textContent =
      name
        .charAt(0)
        .toUpperCase();
}


/* =========================================================
   SEARCH
========================================================= */

let searchTimer = null;

function searchSongs() {

  clearTimeout(searchTimer);

  searchTimer =
    setTimeout(
      runSearch,
      350
    );
}

async function runSearch() {

  const q =
    document
      .getElementById("searchInput")
      .value
      .trim();

  const results =
    document.getElementById(
      "results"
    );

  if (q.length < 2) {

    results.innerHTML = "";

    return;
  }

  try {

    const data =
      await api(
        "/api/search?q=" +
        encodeURIComponent(q)
      );

    results.innerHTML = "";

    if (
      !data.songs ||
      data.songs.length === 0
    ) {

      results.innerHTML =
        '<div class="small">No songs found.</div>';

      return;
    }

    data.songs.forEach(
      song => {

        const div =
          document.createElement(
            "div"
          );

        div.className =
          "song";

        div.innerHTML =

          '<div class="song-title">' +
          escapeHTML(
            song.name || ""
          ) +
          '</div>' +

          '<div class="song-album">' +
          escapeHTML(
            song.album_name || ""
          ) +
          '</div>' +

          '<button onclick="accessSong(' +
          Number(song.id) +
          ')">' +
          'Send to Telegram' +
          '</button>';

        results.appendChild(div);
      }
    );

  } catch (error) {

    results.innerHTML =
      '<div class="errorbox">' +
      escapeHTML(error.message) +
      '</div>';
  }
}


/* =========================================================
   SONG ACCESS
========================================================= */

async function accessSong(songId) {

  try {

    const result =
      await api(
        "/api/song/access",
        {
          method: "POST",

          body: JSON.stringify({
            songId
          })
        }
      );

    if (result.ok) {

      if (tg) {

        try {
          tg.showPopup({
            title: "Song Sent",
            message:
              "The song has been sent to your Telegram.",
            buttons: [
              {
                type: "ok"
              }
            ]
          });
        } catch {}

      } else {

        alert(
          "Song sent to Telegram."
        );
      }

    } else {

      throw new Error(
        result.error ||
        "Unable to send song"
      );
    }

  } catch (error) {

    alert(error.message);
  }
}


/* =========================================================
   LOGOUT
========================================================= */

function logout() {

  currentUser = null;

  document
    .getElementById("dashboard")
    .style.display = "none";

  document
    .getElementById("authCard")
    .style.display = "block";

  document
    .getElementById("pageTitle")
    .textContent =
      "Login";

  setStatus(
    "Telegram account connected.",
    "connected"
  );
}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHTML(value) {

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


/* =========================================================
   START
========================================================= */

(async function () {

  const connected =
    initTelegram();

  if (!connected) {
    return;
  }

  await checkAccount();

})();

</script>

</body>

</html>`;
}

/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(request, env) {

    try {

      /* OPTIONS */

      if (request.method === "OPTIONS") {

        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-headers":
              "Content-Type, X-Telegram-Init-Data",
            "access-control-allow-methods":
              "GET, POST, OPTIONS"
          }
        });
      }

      const url =
        new URL(request.url);


      /* =====================================================
         HOME / LOGIN UI
      ===================================================== */

      if (
        request.method === "GET" &&
        (
          url.pathname === "/" ||
          url.pathname === "/login"
        )
      ) {

        return html(
          appHTML()
        );
      }


      /* =====================================================
         HEALTH
      ===================================================== */

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
            !!env.ADMIN_SECRET
        });
      }


      /* =====================================================
         CURRENT USER
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/me"
      ) {

        const current =
          await getCurrentUser(
            request,
            env
          );

        if (!current.tgUser) {

          return json({
            ok: false,
            error:
              "TELEGRAM_AUTH_REQUIRED"
          }, 401);
        }

        if (!current.row) {

          return json({
            ok: false,
            error:
              "ACCOUNT_NOT_FOUND",
            telegram: {
              id:
                current.tgUser.id,
              username:
                current.tgUser.username || null,
              first_name:
                current.tgUser.first_name || "",
              last_name:
                current.tgUser.last_name || ""
            }
          }, 404);
        }

        if (
          Number(
            current.row.is_active
          ) !== 1
        ) {

          return json({
            ok: false,
            error:
              "ACCOUNT_DISABLED"
          }, 403);
        }

        /* update last login */

        try {

          await env.DB.prepare(`
            UPDATE users
            SET last_login = CURRENT_TIMESTAMP
            WHERE id = ?
          `)
            .bind(
              current.row.id
            )
            .run();

        } catch {}

        return json({
          ok: true,
          user:
            current.row,
          telegram:
            current.tgUser
        });
      }


      /* =====================================================
         REGISTER
      ===================================================== */

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

          return json({
            ok: false,
            error:
              "TELEGRAM_AUTH_REQUIRED"
          }, 401);
        }

        let body;

        try {

          body =
            await request.json();

        } catch {

          return json({
            ok: false,
            error:
              "INVALID_JSON"
          }, 400);
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

          return json({
            ok: false,
            error:
              "NAME_AND_PHONE_REQUIRED"
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
              String(tgUser.id),
              tgUser.username || null,
              name,
              phone,
              email || null
            )

            .run();


          const created =
            await env.DB.prepare(`
              SELECT *
              FROM users
              WHERE telegram_id = ?
              LIMIT 1
            `)
              .bind(
                String(tgUser.id)
              )
              .first();


          return json({
            ok: true,
            message:
              "ACCOUNT_CREATED",
            user:
              created
          });

        } catch (error) {

          console.error(
            "DATABASE ERROR:",
            error
          );

          return json({
            ok: false,
            error:
              "DATABASE_ERROR",
            message:
              String(error)
          }, 500);
        }
      }


      /* =====================================================
         SEARCH
      ===================================================== */

      if (
        request.method === "GET" &&
        url.pathname === "/api/search"
      ) {

        const user =
          await requireUser(
            request,
            env
          );

        if (!user) {

          return json({
            ok: false,
            error:
              "LOGIN_REQUIRED"
          }, 401);
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


      /* =====================================================
         SONG ACCESS
      ===================================================== */

      if (
        request.method === "POST" &&
        url.pathname === "/api/song/access"
      ) {

        const user =
          await requireUser(
            request,
            env
          );

        if (!user) {

          return json({
            ok: false,
            error:
              "LOGIN_REQUIRED"
          }, 401);
        }


        let body;

        try {

          body =
            await request.json();

        } catch {

          return json({
            ok: false,
            error:
              "INVALID_JSON"
          }, 400);
        }


        const songId =
          Number(
            body.songId
          );


        if (!songId) {

          return json({
            ok: false,
            error:
              "SONG_ID_REQUIRED"
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

            LIMIT 1
          `)

            .bind(
              songId
            )

            .first();


        if (!song) {

          return json({
            ok: false,
            error:
              "SONG_NOT_FOUND"
          }, 404);
        }


        if (
          !song.telegram_file_id
        ) {

          return json({
            ok: false,
            error:
              "SONG_NOT_CONFIGURED"
          }, 404);
        }


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

        } catch {}


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
                String(
                  song.name || ""
                ) +
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
            error:
              "TELEGRAM_SEND_FAILED",
            telegram:
              result
          }, 500);
        }


        return json({
          ok: true,
          message:
            "SONG_SENT_TO_TELEGRAM"
        });
      }


      /* =====================================================
         API NOT FOUND
      ===================================================== */

      if (
        url.pathname.startsWith("/api/")
      ) {

        return json({
          ok: false,
          error:
            "API_ROUTE_NOT_FOUND"
        }, 404);
      }


      /* =====================================================
         FALLBACK
      ===================================================== */

      return html(
        appHTML()
      );


    } catch (error) {

      console.error(
        "WORKER ERROR:",
        error
      );

      return json({
        ok: false,
        error:
          "INTERNAL_SERVER_ERROR",
        message:
          String(error)
      }, 500);
    }
  }
};
