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
      "access-control-allow-headers":
        "Content-Type, X-Telegram-Init-Data",
      "access-control-allow-methods":
        "GET, POST, OPTIONS"
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
    .map(b =>
      b.toString(16).padStart(2, "0")
    )
    .join("");
}


/* =========================================================
   TELEGRAM INIT DATA VALIDATION
========================================================= */

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

    params.delete("hash");

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

    /*
      Telegram WebApp secret key
    */

    const secretKey =
      await hmac(
        new TextEncoder().encode(
          "WebAppData"
        ),
        botToken
      );

    const calculatedHash =
      await hmac(
        secretKey,
        dataCheckString
      );

    if (
      hex(calculatedHash).toLowerCase() !==
      receivedHash.toLowerCase()
    ) {

      console.error(
        "Telegram hash validation failed"
      );

      return null;
    }

    const authDate =
      Number(
        params.get("auth_date") || 0
      );

    const now =
      Math.floor(
        Date.now() / 1000
      );

    if (!authDate) {
      return null;
    }

    /*
      Allow maximum 24 hours old
    */

    if (
      now - authDate > 86400 ||
      authDate > now + 60
    ) {

      console.error(
        "Telegram auth_date expired"
      );

      return null;
    }

    const userString =
      params.get("user");

    if (!userString) {
      return null;
    }

    const user =
      JSON.parse(userString);

    if (
      !user ||
      !user.id
    ) {
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


/* =========================================================
   GET TELEGRAM USER
========================================================= */

async function getTelegramUser(
  request,
  env
) {

  /*
    Telegram WebApp init data is sent
    through this header.
  */

  const initData =
    request.headers.get(
      "X-Telegram-Init-Data"
    );

  if (!initData) {

    console.error(
      "X-Telegram-Init-Data missing"
    );

    return null;
  }

  if (!env.BOT_TOKEN) {

    console.error(
      "BOT_TOKEN missing"
    );

    return null;
  }

  const user =
    await validateInitData(
      initData,
      env.BOT_TOKEN
    );

  if (!user) {

    console.error(
      "Telegram authentication failed"
    );

    return null;
  }

  return user;
}


/* =========================================================
   CURRENT USER
========================================================= */

async function requireUser(
  request,
  env
) {

  const tgUser =
    await getTelegramUser(
      request,
      env
    );

  if (!tgUser?.id) {
    return null;
  }

  if (!env.DB) {

    console.error(
      "D1 database binding DB missing"
    );

    return {
      tgUser,
      row: null
    };
  }

  try {

    const row =
      await env.DB
        .prepare(`
          SELECT *
          FROM users
          WHERE telegram_id = ?
          AND is_active = 1
          LIMIT 1
        `)
        .bind(
          String(tgUser.id)
        )
        .first();

    return {
      tgUser,
      row
    };

  } catch (error) {

    console.error(
      "Database user lookup error:",
      error
    );

    return {
      tgUser,
      row: null
    };
  }
}


/* =========================================================
   TELEGRAM API
========================================================= */

async function tgSend(
  env,
  method,
  body
) {

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
            "content-type":
              "application/json"
          },
          body:
            JSON.stringify(body)
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
   HTML APP
========================================================= */

function appHTML() {

return `<!DOCTYPE html>

<html lang="en">

<head>

<meta charset="UTF-8">

<meta
  name="viewport"
  content="width=device-width,
  initial-scale=1.0,
  maximum-scale=1.0,
  user-scalable=no"
>

<title>Telegram Access Bot</title>

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
    Arial,
    Helvetica,
    sans-serif;

  background: #f4f7fb;

  color: #111827;
}

body {
  min-height: 100vh;
}

.page {

  width: 100%;

  min-height: 100vh;

  padding:
    28px 16px;

  display: flex;

  justify-content: center;

  align-items: flex-start;
}

.card {

  width: 100%;

  max-width: 720px;

  background: #ffffff;

  border-radius: 34px;

  padding:
    52px 42px 46px;

  box-shadow:
    0 12px 40px
    rgba(0,0,0,0.08);
}

.logo {

  width: 166px;
  height: 166px;

  margin:
    0 auto 30px;

  border-radius: 38px;

  background: #28a8dc;

  display: flex;

  align-items: center;
  justify-content: center;

  color: #ffffff;

  font-size: 58px;

  font-weight: 800;

  letter-spacing: -2px;
}

h1 {

  margin: 0;

  text-align: center;

  font-size: 42px;

  line-height: 1.15;

  color: #111827;
}

.subtitle {

  text-align: center;

  color: #6b7280;

  font-size: 27px;

  margin-top: 18px;

  margin-bottom: 48px;
}

.status {

  text-align: center;

  font-size: 25px;

  line-height: 1.35;

  margin-bottom: 42px;

  color: #111827;
}

.field {

  margin-bottom: 27px;
}

label {

  display: block;

  font-size: 25px;

  font-weight: 700;

  margin-bottom: 12px;

  color: #111827;
}

input {

  width: 100%;

  height: 82px;

  border:
    1px solid #d6d9de;

  border-radius: 23px;

  padding:
    0 28px;

  font-size: 25px;

  outline: none;

  background: #ffffff;

  color: #111827;
}

input:focus {

  border-color: #28a8dc;

  box-shadow:
    0 0 0 3px
    rgba(40,168,220,0.12);
}

button {

  width: 100%;

  height: 82px;

  border: 0;

  border-radius: 23px;

  background: #28a8dc;

  color: #ffffff;

  font-size: 26px;

  font-weight: 700;

  cursor: pointer;
}

button:disabled {

  opacity: 0.65;

  cursor: default;
}

.message {

  margin-top: 24px;

  padding: 20px;

  border-radius: 20px;

  text-align: center;

  font-size: 22px;

  display: none;

  word-break: break-word;
}

.success {

  display: block;

  background: #dcfce7;

  color: #166534;
}

.error {

  display: block;

  background: #fee2e2;

  color: #991b1b;
}

.account {

  text-align: center;
}

.account-icon {

  width: 110px;
  height: 110px;

  border-radius: 50%;

  background: #28a8dc;

  color: #ffffff;

  display: flex;

  justify-content: center;

  align-items: center;

  margin:
    0 auto 25px;

  font-size: 44px;

  font-weight: 700;
}

.account-name {

  font-size: 34px;

  font-weight: 700;

  margin-bottom: 10px;
}

.account-phone {

  color: #374151;

  font-size: 22px;

  margin-bottom: 8px;
}

.account-email {

  color: #6b7280;

  font-size: 22px;

  margin-bottom: 35px;
}

.profile-box {

  background: #f4f7fb;

  border-radius: 24px;

  padding: 25px;

  margin-bottom: 25px;

  text-align: left;
}

.profile-row {

  display: flex;

  justify-content:
    space-between;

  gap: 20px;

  padding: 12px 0;

  border-bottom:
    1px solid #e5e7eb;
}

.profile-row:last-child {
  border-bottom: 0;
}

.profile-label {

  color: #6b7280;

  font-size: 18px;
}

.profile-value {

  font-size: 18px;

  font-weight: 600;

  text-align: right;

  word-break: break-word;
}

.hidden {
  display: none !important;
}

@media (max-width: 600px) {

  .page {
    padding:
      20px 12px;
  }

  .card {

    border-radius: 30px;

    padding:
      50px
      30px
      42px;
  }

  .logo {

    width: 166px;
    height: 166px;

    margin-bottom: 28px;
  }

  h1 {
    font-size: 40px;
  }

  .subtitle {

    font-size: 26px;

    margin-bottom: 45px;
  }

  .status {
    font-size: 24px;
  }

  label {
    font-size: 24px;
  }

  input {

    height: 80px;

    font-size: 24px;
  }

  button {

    height: 80px;

    font-size: 25px;
  }
}

</style>

</head>

<body>

<div class="page">

  <div class="card">

    <div class="logo">
      A2Z
    </div>

    <h1 id="title">
      Create Account
    </h1>

    <div class="subtitle">
      a2z Malayalam Songs
    </div>

    <div
      id="status"
      class="status"
    >
      Connecting to Telegram...
    </div>

    <!-- CREATE ACCOUNT -->

    <div id="form">

      <div class="field">

        <label>
          Name
        </label>

        <input
          id="name"
          type="text"
          placeholder="Enter your name"
          autocomplete="name"
        >

      </div>

      <div class="field">

        <label>
          Phone
        </label>

        <input
          id="phone"
          type="tel"
          placeholder="Enter phone number"
          autocomplete="tel"
        >

      </div>

      <div class="field">

        <label>
          Email
        </label>

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

    </div>


    <!-- MESSAGE -->

    <div
      id="message"
      class="message"
    ></div>


    <!-- PROFILE -->

    <div
      id="account"
      class="account hidden"
    >

      <div class="account-icon">
        ✓
      </div>

      <div
        id="accountName"
        class="account-name"
      ></div>

      <div class="profile-box">

        <div class="profile-row">

          <div class="profile-label">
            Name
          </div>

          <div
            id="profileName"
            class="profile-value"
          ></div>

        </div>

        <div class="profile-row">

          <div class="profile-label">
            Phone
          </div>

          <div
            id="profilePhone"
            class="profile-value"
          ></div>

        </div>

        <div class="profile-row">

          <div class="profile-label">
            Email
          </div>

          <div
            id="profileEmail"
            class="profile-value"
          ></div>

        </div>

        <div class="profile-row">

          <div class="profile-label">
            Telegram
          </div>

          <div
            id="profileTelegram"
            class="profile-value"
          ></div>

        </div>

      </div>

      <button
        onclick="closeApp()"
      >
        Continue
      </button>

    </div>

  </div>

</div>


<script>

/* ======================================================
   TELEGRAM WEB APP
====================================================== */

const tg =
  window.Telegram &&
  window.Telegram.WebApp
    ? window.Telegram.WebApp
    : null;


/* ======================================================
   INIT DATA
====================================================== */

function getInitData() {

  if (!tg) {
    return "";
  }

  return tg.initData || "";
}


/* ======================================================
   API
====================================================== */

async function api(
  url,
  options = {}
) {

  const headers = {
    ...(options.headers || {})
  };

  const initData =
    getInitData();

  /*
    IMPORTANT:
    Send Telegram signed initData
    with every API request.
  */

  if (initData) {

    headers[
      "X-Telegram-Init-Data"
    ] = initData;
  }

  if (
    options.body &&
    !headers["content-type"]
  ) {

    headers["content-type"] =
      "application/json";
  }

  return fetch(
    url,
    {
      ...options,
      headers
    }
  );
}


/* ======================================================
   MESSAGE
====================================================== */

function showMessage(
  text,
  type
) {

  const el =
    document.getElementById(
      "message"
    );

  el.textContent =
    text;

  el.className =
    "message " + type;
}


/* ======================================================
   SHOW PROFILE
====================================================== */

function showProfile(user) {

  document
    .getElementById("title")
    .textContent =
      "Welcome Back";

  document
    .getElementById("status")
    .textContent =
      "Your account is connected.";

  document
    .getElementById("form")
    .classList.add(
      "hidden"
    );

  document
    .getElementById("message")
    .className =
      "message";

  document
    .getElementById("account")
    .classList.remove(
      "hidden"
    );

  document
    .getElementById("accountName")
    .textContent =
      user.name ||
      "User";

  document
    .getElementById("profileName")
    .textContent =
      user.name ||
      "-";

  document
    .getElementById("profilePhone")
    .textContent =
      user.phone ||
      "-";

  document
    .getElementById("profileEmail")
    .textContent =
      user.email ||
      "-";

  document
    .getElementById("profileTelegram")
    .textContent =
      user.telegram_username
        ? "@" +
          user.telegram_username
        : "Connected";
}


/* ======================================================
   CHECK LOGIN
====================================================== */

async function checkLogin() {

  const status =
    document.getElementById(
      "status"
    );

  const initData =
    getInitData();


  /*
    If opened outside Telegram
  */

  if (!initData) {

    status.textContent =
      "Please open this page from Telegram.";

    return;
  }


  /*
    Get Telegram user information
    for name autofill.
  */

  const tgUser =
    tg?.initDataUnsafe?.user;


  if (tgUser) {

    const fullName =
      [
        tgUser.first_name,
        tgUser.last_name
      ]
      .filter(Boolean)
      .join(" ");

    const nameInput =
      document.getElementById(
        "name"
      );

    if (
      nameInput &&
      !nameInput.value
    ) {

      nameInput.value =
        fullName || "";
    }
  }


  try {

    const response =
      await api(
        "/api/me"
      );

    const data =
      await response.json();


    /*
      Existing account
    */

    if (
      response.ok &&
      data.ok &&
      data.user
    ) {

      showProfile(
        data.user
      );

      return;
    }


    /*
      Telegram connected,
      but account not created.
    */

    if (
      data.error ===
      "LOGIN_REQUIRED"
    ) {

      status.textContent =
        "Telegram account connected. Create your account.";

      return;
    }


    /*
      Authentication problem
    */

    if (
      data.error ===
      "TELEGRAM_AUTH_REQUIRED"
    ) {

      status.textContent =
        "Telegram authentication required.";

      return;
    }


    status.textContent =
      "Unable to check account.";

    console.error(
      "API /api/me:",
      data
    );

  } catch (error) {

    console.error(
      "checkLogin error:",
      error
    );

    status.textContent =
      "Connection error.";
  }
}


/* ======================================================
   CREATE ACCOUNT
====================================================== */

async function createAccount() {

  const button =
    document.getElementById(
      "createBtn"
    );

  const name =
    document.getElementById(
      "name"
    ).value.trim();

  const phone =
    document.getElementById(
      "phone"
    ).value.trim();

  const email =
    document.getElementById(
      "email"
    ).value.trim();


  if (!name) {

    showMessage(
      "Please enter your name.",
      "error"
    );

    return;
  }


  if (!phone) {

    showMessage(
      "Please enter your phone number.",
      "error"
    );

    return;
  }


  const initData =
    getInitData();


  if (!initData) {

    showMessage(
      "Please open this page from Telegram.",
      "error"
    );

    return;
  }


  button.disabled = true;

  button.textContent =
    "Creating Account...";


  try {

    const response =
      await api(
        "/api/register",
        {
          method: "POST",

          body:
            JSON.stringify({
              name,
              phone,
              email
            })
        }
      );


    const data =
      await response.json();


    console.log(
      "REGISTER RESPONSE:",
      data
    );


    if (
      !response.ok ||
      !data.ok
    ) {

      showMessage(
        data.message ||
        data.error ||
        "Account creation failed.",
        "error"
      );

      button.disabled =
        false;

      button.textContent =
        "Create Account";

      return;
    }


    /*
      Account created successfully.
      Now request /api/me again,
      so profile is loaded from D1.
    */

    showMessage(
      "Account created successfully!",
      "success"
    );


    const meResponse =
      await api(
        "/api/me"
      );


    const meData =
      await meResponse.json();


    if (
      meResponse.ok &&
      meData.ok &&
      meData.user
    ) {

      setTimeout(
        () => {

          showProfile(
            meData.user
          );

        },
        500
      );

    } else {

      /*
        Fallback profile
      */

      setTimeout(
        () => {

          showProfile({
            name,
            phone,
            email
          });

        },
        500
      );
    }


  } catch (error) {

    console.error(
      "Register error:",
      error
    );

    showMessage(
      "Server connection failed.",
      "error"
    );

    button.disabled =
      false;

    button.textContent =
      "Create Account";
  }
}


/* ======================================================
   CLOSE TELEGRAM APP
====================================================== */

function closeApp() {

  if (tg) {

    try {

      tg.close();

      return;

    } catch {}
  }
}


/* ======================================================
   TELEGRAM START
====================================================== */

if (tg) {

  try {

    tg.ready();

    tg.expand();

    tg.setHeaderColor(
      "#ffffff"
    );

    tg.setBackgroundColor(
      "#f4f7fb"
    );

  } catch (error) {

    console.error(
      "Telegram UI error:",
      error
    );
  }
}


/* ======================================================
   START
====================================================== */

checkLogin();

</script>

</body>

</html>`;
}


/* =========================================================
   WORKER
========================================================= */

export default {

  async fetch(
    request,
    env
  ) {

    try {

      /* =================================================
         OPTIONS
      ================================================= */

      if (
        request.method ===
        "OPTIONS"
      ) {

        return new Response(
          null,
          {
            status: 204,
            headers: {
              "access-control-allow-origin":
                "*",
              "access-control-allow-headers":
                "Content-Type, X-Telegram-Init-Data",
              "access-control-allow-methods":
                "GET, POST, OPTIONS"
            }
          }
        );
      }


      const url =
        new URL(
          request.url
        );


      /* =================================================
         HEALTH
      ================================================= */

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
            !!env.ADMIN_SECRET

        });
      }


      /* =================================================
         CURRENT USER
      ================================================= */

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


        /*
          Telegram authentication
          failed.
        */

        if (!user?.tgUser) {

          return json(
            {
              ok: false,
              error:
                "TELEGRAM_AUTH_REQUIRED"
            },
            401
          );
        }


        /*
          Telegram connected,
          but no account in D1.
        */

        if (!user.row) {

          return json(
            {
              ok: false,

              error:
                "LOGIN_REQUIRED",

              telegram: {
                id:
                  user.tgUser.id,

                username:
                  user.tgUser.username ||
                  null,

                first_name:
                  user.tgUser.first_name ||
                  "",

                last_name:
                  user.tgUser.last_name ||
                  ""
              }
            },
            401
          );
        }


        /*
          Existing account
        */

        return json({

          ok: true,

          user:
            user.row,

          telegram:
            user.tgUser

        });
      }


      /* =================================================
         REGISTER
      ================================================= */

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


        /*
          Telegram authentication
          required.
        */

        if (!user?.tgUser) {

          return json(
            {
              ok: false,

              error:
                "TELEGRAM_AUTH_REQUIRED",

              message:
                "Telegram authentication is required."
            },
            401
          );
        }


        /*
          Database required
        */

        if (!env.DB) {

          return json(
            {
              ok: false,

              error:
                "DATABASE_NOT_CONFIGURED",

              message:
                "D1 database binding DB is missing."
            },
            500
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
                "NAME_AND_PHONE_REQUIRED",

              message:
                "Name and phone are required."
            },
            400
          );
        }


        try {

          /*
            Create or update account.
          */

          await env.DB
            .prepare(`
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

                is_verified =
                  1,

                is_active =
                  1
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


          /*
            Get newly-created account
          */

          const createdUser =
            await env.DB
              .prepare(`
                SELECT *
                FROM users
                WHERE telegram_id = ?
                LIMIT 1
              `)
              .bind(
                String(
                  user.tgUser.id
                )
              )
              .first();


          return json({

            ok: true,

            message:
              "ACCOUNT_CREATED",

            user:
              createdUser

          });


        } catch (error) {

          console.error(
            "DATABASE REGISTER ERROR:",
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


      /* =================================================
         SEARCH
      ================================================= */

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
            url.searchParams
              .get("q") || ""
          ).trim();


        if (q.length < 2) {

          return json({

            ok: true,

            albums: [],

            songs: []

          });
        }


        const songs =
          await env.DB
            .prepare(`
              SELECT
                s.*,
                a.name AS album_name

              FROM songs s

              LEFT JOIN albums a
                ON a.id = s.album_id

              WHERE
                s.name LIKE ?
                OR a.name LIKE ?

              ORDER BY
                s.name

              LIMIT 50
            `)
            .bind(
              `%${q}%`,
              `%${q}%`
            )
            .all();


        const albums =
          await env.DB
            .prepare(`
              SELECT *

              FROM albums

              WHERE name LIKE ?

              ORDER BY
                name

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


      /* =================================================
         SONG ACCESS
      ================================================= */

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
          await env.DB
            .prepare(`
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


        /*
          Access log
        */

        try {

          await env.DB
            .prepare(`
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

          console.log(
            "Access log skipped:",
            error
          );
        }


        /*
          Send audio to Telegram
        */

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


      /* =================================================
         HOME / LOGIN / CREATE ACCOUNT
      ================================================= */

      if (
        request.method === "GET" &&
        (
          url.pathname === "/" ||
          url.pathname === "/login" ||
          url.pathname ===
            "/create-account"
        )
      ) {

        return html(
          appHTML()
        );
      }


      /* =================================================
         UNKNOWN API
      ================================================= */

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


      /* =================================================
         404
      ================================================= */

      return new Response(
        "Not Found",
        {
          status: 404,

          headers: {
            "content-type":
              "text/plain; charset=UTF-8"
          }
        }
      );


    } catch (error) {

      console.error(
        "WORKER ERROR:",
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
