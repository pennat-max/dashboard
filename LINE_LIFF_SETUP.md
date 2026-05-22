# LINE LIFF — VIGO4U OS (Order Tracking)

## What is LIFF?

**LIFF (LINE Front-end Framework)** is a way to run a **web app inside the LINE in-app browser** (and in some cases the external browser) with a small JavaScript SDK (`@line/liff`). A **LIFF app** is registered in the LINE Developers Console and points at a **public HTTPS URL** (e.g. your Vercel deployment).

This project uses LIFF **Phase 1** as a **thin wrapper** around the existing **Order Tracking** UI — same data path as `/m/orders`, no duplicate business logic.

## What this repo does (Phase 1)

- **Route:** `/liff/orders`
- **UI:** Reuses `MobileOrderTrackingHome` (same as `/m/orders`).
- **SDK:** `NEXT_PUBLIC_LINE_LIFF_ID` → `liff.init` + optional `getProfile()` when the user is in LINE and logged in to the LIFF channel.
- **No** LINE Bot, **no** Messaging API webhook, **no** group message reading, **no** push from this app.

## Create a LIFF app (LINE Developers)

1. Open [LINE Developers Console](https://developers.line.biz/) → your **Provider** → **LINE Login** (or Messaging API) channel, or create a **LINE Login** channel if you only need LIFF.
2. Open the channel → **LIFF** tab → **Add** (or **Create LIFF app**).
3. Set:
   - **Size:** often **Full** for a full-screen ops UI (or **Tall** if you prefer).
   - **Endpoint URL:** the page users open — e.g.  
     `https://<your-vercel-app>.vercel.app/liff/orders`  
     (use your real production domain when you have one).
   - **Scope:** for Phase 1, **profile** (and **openid** if the console requires it) is enough to read `displayName` / `pictureUrl` when the user is logged in to LIFF. Do not request more than you need.
4. After saving, copy the **LIFF ID** (string like `1234567890-abcdefgh`).

## Environment variable

| Variable | Where | Notes |
|----------|--------|--------|
| `NEXT_PUBLIC_LINE_LIFF_ID` | `.env.local` (dev), Vercel **Environment Variables** (prod) | **Public** — safe to expose; it is not a secret. |

If this variable is **missing**, the app still loads `/liff/orders` in a normal browser and shows a small **“Missing NEXT_PUBLIC_LINE_LIFF_ID”** strip — it does **not** crash.

**Never** put `SUPABASE_SERVICE_ROLE_KEY` or any server secret in a `NEXT_PUBLIC_*` variable or in the LIFF page bundle.

## Supabase / auth note

- **`/m/*` and `/liff/*` do not require login** in middleware — anyone with the link can open Order Tracking.
- **Order mutate APIs** (`/api/m/order-items/*`, `order-intake/save`, etc.) **allow writes without a Supabase user by default** (synthetic server-side role). To **require login + `profiles` role** for writes, set **`OPEN_ORDER_TRACKING_MUTATIONS=false`** in Vercel / env. See `src/lib/auth/open-order-tracking-mutations.ts`.
- **Service role** stays **server-only** — see `src/lib/supabase/service-role.ts`.

## Test in a desktop browser

1. Set `NEXT_PUBLIC_LINE_LIFF_ID` in `.env.local` and restart `npm run dev`.
2. Open `http://localhost:3000/liff/orders`.
3. You should see the LIFF status strip; outside LINE it will show **Browser preview** (or a LIFF init message if the SDK cannot fully emulate in-app).

## Test inside LINE

1. Deploy the same app to **HTTPS** (e.g. Vercel) with `NEXT_PUBLIC_LINE_LIFF_ID` set for **Production**.
2. In LINE Developers, set the LIFF **Endpoint URL** to your deployed `/liff/orders` URL.
3. Open the LIFF app from a **LINE chat / Rich Menu / URL** that launches your LIFF URL (exact UX depends on how you attach the LIFF app to your channel).
4. Confirm Order Tracking loads; optional: after LINE login to the channel, profile name may appear in the strip.

## Not implemented yet (by design)

- LINE **Messaging API** bot + webhook  
- Group chat ingestion  
- Push messages from this app  
- Google Sheet sync  
- Two-way sync  

## Related code

- `src/lib/line/liff-config.ts` — reads `NEXT_PUBLIC_LINE_LIFF_ID`
- `src/components/liff/liff-orders-shell.tsx` — LIFF init + indicator strip
- `src/app/(app)/liff/orders/page.tsx` — entry route
- `src/lib/order-tracking/load-order-tracking-page.ts` — shared loader with `/m/orders`
