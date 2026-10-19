# LocalMarket Liberia

LocalMarket is a mobile-first marketplace preview with a same-origin Node.js API and SQLite database. Product listings, vendor applications, order requests, and admin actions are stored on the server. The sample listings are examples, not active merchants. The preview does not collect payments or dispatch deliveries.

## Requirements

- Node.js 24.15 or later (the built-in `node:sqlite` API is used; no npm packages are required).

## Run locally

From this directory:

```powershell
npm run admin:create
npm start
```

The first command asks for an admin email and password in the terminal. Password input is hidden. Use a unique password with at least 14 characters. The server stores only a salted scrypt hash; the plaintext password is never written to the project files. Open `http://localhost:8080` in your browser.

For an existing local database, change the admin password with `npm run admin:reset-password`. This signs out all existing admin sessions.

The database is created at `data/localmarket.sqlite`. It is ignored by Git. Back it up securely and do not place the live database in a public static hosting folder.

## Admin security

- Admin credentials are checked by the server, not embedded in the browser app.
- Passwords use Node's asynchronous scrypt with a unique random salt.
- Admin sessions use random, server-validated tokens; the database stores a SHA-256 token hash.
- The session cookie is `HttpOnly` and `SameSite=Strict`, expires after four hours, and has `Secure` set when the configured app origin uses HTTPS.
- Admin write requests require an origin match and a CSRF token.
- Login attempts are limited by source IP; responses and server headers restrict caching and browser capabilities.
- There is no client-side admin bypass and no sample password in source files.

## API overview

- `GET /api/products` — active public listings
- `POST /api/orders` — server-validates listing IDs, quantities, and order totals before storing an order request
- `POST /api/vendor-applications` — stores a vendor application for staff review
- `/api/admin/*` — session, overview, vendor review, order status, and listing management; all admin access is server-checked

## Deploying behind HTTPS

The server binds to `127.0.0.1` by default. Put it behind an HTTPS reverse proxy and set `APP_ORIGIN` to the public HTTPS origin, such as `https://market.example.com`. Keep the Node server and SQLite data directory private to the host. Set `DATA_DIR` to a durable, access-restricted directory outside the web root. Do not set a public bind address without a correctly configured TLS proxy and firewall. Create the first administrator on the host with `node server.js create-admin`; reset credentials with `node server.js reset-admin-password`.

## Preview limits before a public marketplace launch

- Seed listings, prices, descriptions, and rating counts are sample data. Replace them with real vendor-approved listings before marketing the marketplace as live.
- Order requests are stored centrally, but no seller notification, payment processing, refund flow, or delivery service is connected.
- Vendor review is a manual status workflow; it does not perform identity or business-document verification.
- Customer and vendor contact details are stored in SQLite. Define retention and deletion rules, restrict and monitor operator access, protect backups, and publish the final privacy policy before accepting real users.
- Admin password recovery is a local server operation. Add a controlled recovery process and multi-factor authentication before production use.
- The sample admin page is not a substitute for a reviewed production security assessment.

