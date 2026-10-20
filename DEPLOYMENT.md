# Web deployment

LocalMarket is a Node.js web service, not a static site. The backend and SQLite database must run together, and the database directory must be persistent and private.

## Render setup

The repository includes a Render Blueprint in `render.yaml`. In Render, create a Blueprint from this GitHub repository and review the proposed service before applying it. The Blueprint uses a paid web service and a 1 GB persistent disk for SQLite. Do not switch this service to a free instance: free Render web services have ephemeral storage, so the database can disappear on a restart, deploy, or spin-down. Review Render's current billing before applying the Blueprint.

Render provides HTTPS and sets `RENDER_EXTERNAL_URL`; the server uses that value for origin and secure-cookie checks. If you later add a custom domain, set `APP_ORIGIN` to that exact HTTPS origin. Set this value when prompted:

- `PUBLIC_CONTACT_EMAIL`: a monitored address for privacy questions, access/deletion requests, and vendor follow-up.
- `DATA_RETENTION_DAYS`: the Blueprint starts with a 90-day pilot period for order requests and pending/declined vendor applications. Change the value if your operating policy requires a different period. The server deletes expired records daily. Verified vendor contact details remain while the vendor relationship is active.

The service starts in `preview` mode with `PUBLIC_INTAKE_ENABLED=false`. It shows clearly labeled examples, collects no vendor or customer details, and rejects all orders. The server requires an HTTPS origin, a configured private data directory, a monitored contact email, and a retention period before it starts in production. Keep intake disabled until private backups and a daily request-review process are in place. Then set `PUBLIC_INTAKE_ENABLED=true` to accept vendor applications; order requests remain closed until `MARKETPLACE_MODE=pilot`.

## Initialize the administrator

After the service is running, open its private shell in Render and run:

```sh
npm run admin:create
```

Enter a monitored admin email and a unique password of at least 14 characters. Do not put the password in Git, a Blueprint, or a public chat. The persistent disk must be mounted at `/var/data` before running this command.

## Turn on a real-vendor pilot

Keep `MARKETPLACE_MODE=preview` until the privacy settings are complete and the marketplace has real vendors and listings. In the admin screen, review each application, verify the vendor directly, and add only vendor-approved listings. Then change `MARKETPLACE_MODE` to `pilot` and redeploy. Pilot mode hides all sample listings and accepts order requests only for active listings linked to a verified vendor.

Order requests are manual inquiries: this app does not collect money, notify sellers, arrange delivery, or guarantee stock. Assign an operator to check the admin dashboard every business day and confirm requests with customers and vendors by phone or WhatsApp. Keep one running service instance because SQLite and its persistent disk are single-instance storage.

## Backups and operations

The Blueprint persists the live SQLite database, but it does not create backups. Before collecting real user information, configure a private backup process, restrict access to backups, and expire backup copies in line with the published retention policy. Periodically restore a backup in a separate environment to verify that recovery works. Keep the server and privacy contact monitored, and switch back to preview mode if order follow-up or data access cannot be maintained.

