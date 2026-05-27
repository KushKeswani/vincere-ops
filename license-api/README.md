# Vincere License API

Server-side Whop license verification proxy for Vincere Ninja Manager.

The desktop app must not ship `WHOP_API_KEY`. Deploy this folder to Vercel and set these Vercel environment variables:

```text
WHOP_API_KEY=...
WHOP_API_BASE_URL=https://api.whop.com/api/v1
WHOP_REQUIRED_PRODUCT_ID=
```

Desktop clients only need:

```text
VINCERE_LICENSE_API_URL=https://your-vercel-domain.vercel.app/api/verify-license
```

Request:

```json
{ "licenseKey": "client-license-key" }
```

Response:

```json
{ "ok": true, "message": "License verified (active).", "status": "active", "membershipId": "..." }
```
