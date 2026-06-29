# Unified Payment Site

A single Express app that lets a customer enter an amount and Visa card details on your own page, then automatically tries to charge the card through:

1. **Payone** (Direct Post)
2. **PayTabs** (Own Form / server-to-server)
3. **Payzaty** (Direct Pay `/checkout/pay`)

If a gateway needs extra customer data (name, email, phone, address), the backend calls **Gemini** to generate realistic details matching the card’s country. If a gateway requires 3-D Secure / OTP, the customer is redirected to the issuer/gateway page and then returned. If one gateway declines, the next is tried automatically.

## Quick start

```bash
cd UnifiedPayment
npm install
cp .env.example .env
# Fill in your real gateway credentials and Gemini key
npm run dev
```

Then open `http://localhost:3000`.

## Configuration

See `.env.example` for all required variables. At minimum you need:

- `PAYMENT_SESSION_SECRET` — 32+ byte secret used to encrypt session data.
- `GEMINI_API_KEY` — to auto-generate country-specific customer details.
- Payone, PayTabs and Payzaty credentials.

## Flow

1. Customer enters amount + card on `/`.
2. Frontend calls `POST /api/start-payment`.
3. Backend detects country from the card BIN and generates customer details with Gemini.
4. Backend tries Payone first.
   - Payone Direct Post renders an auto-submitting page that POSTs the card data to Payone.
   - Payone returns the final result to `/api/callback/payone`.
5. If Payone fails, PayTabs Own Form is called server-to-server.
   - Non-3DS cards return an immediate result.
   - 3DS cards return a `redirect_url`; customer is sent there and returns to `/api/callback/paytabs`.
6. If PayTabs fails, Payzaty Direct Pay is called.
   - Similar success / 3DS-redirect / failure handling via `/api/callback/payzaty`.
7. Final result is shown on `/result.html`.
8. Visit `/dashboard` to see real-time stats and a searchable table of all payment attempts.

## Security notes

- This integration collects raw card data on your server. Run only over **HTTPS**.
- Card data is kept in short-lived, AES-256-GCM encrypted sessions and is never logged.
- PCI-DSS compliance is the merchant’s responsibility.

## Deployment

The project is ready for Vercel via `vercel.json`. For serverless deployments set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` so session data persists between requests.
