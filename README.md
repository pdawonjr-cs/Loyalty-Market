# LocalMarket Liberia

LocalMarket is a mobile-first catalog and manual order-request pilot for local Liberian vendors. It is a same-origin Node.js service with a SQLite database; it is not a static site. The application does not collect payments, notify sellers, or arrange delivery.

## Run locally

Use Node.js 24.15 or later (`node:sqlite` is built into Node). From this directory:

```sh
node server.js create-admin
node server.js
```

The admin command asks for an email and password in an interactive terminal. Password input is hidden. Use a unique password with at least 14 characters. The database is created at `data/localmarket.sqlite`, a Git-ignored path. Open `http://localhost:8080` in a browser.

Local mode defaults to `MARKETPLACE_MODE=preview` and `PUBLIC_INTAKE_ENABLED=false`. It displays clearly labeled examples, does not accept orders, and does not collect vendor details until intake is explicitly enabled with privacy settings configured.

To reset the local admin password, run `node server.js reset-admin-password`.

## Deploy the web preview

`render.yaml` defines a Render web service with a private persistent disk for SQLite. Follow [DEPLOYMENT.md](DEPLOYMENT.md) to configure it and [PILOT_LAUNCH.md](PILOT_LAUNCH.md) to recruit the first vendors and shoppers. Render's free web services cannot keep this SQLite database on disk; the Blueprint uses a paid service. Review the hosting bill before applying it.

Production requires:

- HTTPS through the host and `APP_ORIGIN` (Render's `RENDER_EXTERNAL_URL` is used automatically).
- A private, persistent `DATA_DIR`.
- A monitored `PUBLIC_CONTACT_EMAIL`.
- A chosen `DATA_RETENTION_DAYS` period.

Until those are configured, the server refuses to start in production. The Render Blueprint also leaves `PUBLIC_INTAKE_ENABLED=false`, so the deployed preview can be visited without collecting personal details. Preview mode blocks orders. Pilot mode hides all examples and accepts order requests only for active listings tied to a verified vendor. The app records privacy acceptance for vendor applications and order requests and automatically deletes expired orders and pending/declined vendor applications once a day. Verified vendor contact details are kept while the vendor relationship is active.

## Admin security and operations

- Admin credentials are checked by the server; passwords are stored as salted scrypt hashes.
- Admin sessions use random, server-validated tokens; the database stores a SHA-256 token hash.
- The session cookie is `HttpOnly` and `SameSite=Strict`, expires after four hours, and uses `Secure` for HTTPS.
- Admin write requests require an origin match and CSRF token.
- Login attempts are limited by source IP; responses include browser security headers.
- There is no default admin password in source files.
- Order requests are manual inquiries, not confirmed purchases. An operator must review the admin dashboard every business day and contact both sides by phone or WhatsApp.
- The operator must configure private backups and ensure backup access and expiration follow the published privacy policy. The Render Blueprint does not create backups.

## API overview

- `GET /api/config` — public preview/pilot state and whether intake is open
- `GET /api/health` — database-backed health check
- `GET /api/products` — active listings; in pilot mode only verified-vendor listings
- `POST /api/orders` — creates a manual request for verified-vendor listings in pilot mode
- `POST /api/vendor-applications` — stores a vendor application when privacy settings are configured
- `/api/admin/*` — session, overview, vendor review, order status, and listing management; all admin access is server-checked

