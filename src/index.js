// -----------------------------------------------
// CREATE ACCOUNT
// -----------------------------------------------

if (
  request.method === "POST" &&
  url.pathname === "/api/register"
) {

  // IMPORTANT:
  // Registration does NOT require an existing DB user.
  // It only requires valid Telegram Mini App authentication.

  const tgUser =
    await getTelegramUser(request, env);

  if (!tgUser?.id) {
    return json({
      ok: false,
      error: "TELEGRAM_AUTH_REQUIRED"
    }, 401);
  }

  if (!env.DB) {
    return json({
      ok: false,
      error: "DATABASE_NOT_CONFIGURED"
    }, 500);
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

  const telegramId =
    String(tgUser.id);

  const telegramUsername =
    tgUser.username || null;

  try {

    // -------------------------------------------
    // Check if Telegram account already exists
    // -------------------------------------------

    const existing =
      await env.DB.prepare(`
        SELECT id
        FROM users
        WHERE telegram_id = ?
        LIMIT 1
      `)
      .bind(telegramId)
      .first();

    // -------------------------------------------
    // UPDATE EXISTING USER
    // -------------------------------------------

    if (existing) {

      await env.DB.prepare(`
        UPDATE users
        SET
          telegram_username = ?,
          name = ?,
          phone = ?,
          email = ?,
          is_verified = 1,
          is_active = 1,
          last_login = CURRENT_TIMESTAMP
        WHERE telegram_id = ?
      `)
      .bind(
        telegramUsername,
        name,
        phone,
        email || null,
        telegramId
      )
      .run();

      return json({
        ok: true,
        message: "ACCOUNT_UPDATED",
        user: {
          id: existing.id,
          telegram_id: telegramId,
          name,
          phone,
          email: email || null,
          telegram_username: telegramUsername
        }
      });
    }

    // -------------------------------------------
    // CREATE NEW USER
    // -------------------------------------------

    const result =
      await env.DB.prepare(`
        INSERT INTO users(
          telegram_id,
          telegram_username,
          name,
          phone,
          email,
          is_verified,
          is_active,
          last_login
        )
        VALUES(?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      `)
      .bind(
        telegramId,
        telegramUsername,
        name,
        phone,
        email || null,
        1,
        1
      )
      .run();

    return json({
      ok: true,
      message: "ACCOUNT_CREATED",
      user: {
        id: result.meta?.last_row_id || null,
        telegram_id: telegramId,
        name,
        phone,
        email: email || null,
        telegram_username: telegramUsername
      }
    });

  } catch (error) {

    console.error("REGISTER ERROR:", error);

    return json({
      ok: false,
      error: "DATABASE_ERROR",
      message: String(error)
    }, 500);
  }
}
