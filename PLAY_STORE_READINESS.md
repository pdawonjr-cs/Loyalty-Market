# Google Play submission preparation

## Listing draft

- **App name:** LocalMarket Liberia
- **Category:** Shopping
- **Short description:** Discover local Liberian products and explore a community marketplace preview.
- **Full description:** LocalMarket Liberia is a preview of a community-first marketplace concept. Browse sample listings by category, search products, view seller and product details, manage a basket, submit an order request to the marketplace server, and apply to become a vendor. This version includes sample sellers and listings, does not process payments, and does not arrange delivery. Order and vendor application details are stored on the server for staff review.
- **Suggested package name (provisional):** `lr.localmarket.liberia`
- **Target age:** General audience; not designed specifically for children.
- **Pricing:** Free.
- **Support email:** Must be supplied by the publisher.
- **Privacy policy URL:** Must be hosted at a permanent public HTTPS URL after publisher contact details and policy are confirmed.

## What is ready

- Store name, category, descriptions, and a provisional app icon are prepared.
- A privacy-policy draft is linked from the preview app.
- A Node.js and SQLite backend now handles admin login, vendor applications, order requests, and listing moderation. Admin setup is performed from the server terminal; no default password is shipped in the app.
- The web app can be wrapped as an Android app, but no signed Android App Bundle has been produced.

## Release blockers

1. **The backend is not hosted.** The database and admin account exist only when initialized on a server. Hosting, durable backups, HTTPS, monitoring, data retention/deletion, and operational support still need setup.
2. **The marketplace is still a preview.** Sample listings are not live merchants. Order requests are stored centrally, but sellers are not notified; payment processing, refunds, and delivery are not connected.
3. **No Android build toolchain is installed in this workspace.** A signed `.aab` needs to be built with Android SDK/build tools and a signing key. Package name is permanent once the app is created in Play Console, so confirm it before creation.
4. **No Play Console connection is available here.** Publishing requires a verified Google Play developer account, app setup, declarations, store listing assets, and a signed bundle.
5. **Publisher details are missing.** A support/privacy email and public HTTPS privacy-policy URL are needed. The draft policy contains a placeholder and unfinished retention/deletion details.
6. **Store assets are incomplete.** The listing still needs phone screenshots and a feature graphic; these should show the accurate preview experience.
7. **Testing may be required.** Google says personal developer accounts created after November 13, 2023 must complete a closed test with at least 12 testers opted in continuously for 14 days before applying for production access. The account type and creation date need to be checked in Play Console.

## Suggested next stage

Deploy and secure the backend first, replace sample listings with approved merchants, add payment and delivery integrations if needed, finish privacy operations, and then install Android Studio with API 36 build tools. Build and sign an Android App Bundle, host the final privacy policy and support page, complete Play Console declarations, and start internal/closed testing before requesting production release.
