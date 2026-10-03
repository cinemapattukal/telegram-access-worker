# Telegram Access — real setup

## What this build does
- Telegram Mini App authentication using Telegram `initData` validation on the server.
- Account creation with name + phone + optional email.
- D1 user database.
- Search albums/songs only after a valid account exists.
- Song access sends a stored Telegram `file_id` to the authenticated Telegram user.
- Admin API for adding song records.

## Important
1. Do NOT put your Telegram bot token in frontend JavaScript.
2. Put the bot token in a Cloudflare Worker secret named `BOT_TOKEN`.
3. Put a long random admin secret in `ADMIN_SECRET`.
4. Create a D1 database and replace `database_id` in `wrangler.toml`.
5. Apply `schema.sql`.
6. Deploy the Worker with its `public/` assets.
7. Set the Mini App URL in BotFather.
8. For real SMS verification of phone numbers, connect an SMS provider. This starter only stores the phone number the user enters.

## Telegram channel song files
The bot must be an administrator in the channel so you can capture/store each uploaded song's `file_id`. Store that `file_id` in the `songs.telegram_file_id` column. The Mini App then calls `/api/song/access`, which checks the authenticated Telegram user before sending the audio to that user.

## Deploy with Wrangler
Install/login to Wrangler, edit `wrangler.toml`, then:
- `npx wrangler d1 execute telegram_access_db --remote --file=schema.sql`
- `npx wrangler secret put BOT_TOKEN`
- `npx wrangler secret put ADMIN_SECRET`
- `npx wrangler deploy`

Use a strong random ADMIN_SECRET. Never expose it to the browser.

Update configuration
