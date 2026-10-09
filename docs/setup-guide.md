# Setup guide

This guide takes you from nothing to a working test payment, then to live payments. No coding is needed for the payment server; developers can also use the [API](api.md) or the [Node.js library](node-library.md).

## 1. What you need

- A computer or server with [Node.js](https://nodejs.org) 20 or newer. Check with `node --version`.
- Sandbox (test) keys for at least one gateway. The [gateway guide](gateways.md) says where to get each one. SSLCommerz and shurjoPay are the quickest to start with.
- Optional: a [BulkSMSBD](https://bulksmsbd.net) account for SMS. In sandbox mode SMS are never sent, so you can skip this at first.

## 2. Install

```bash
git clone https://github.com/Flowthera/bd-connector
cd bd-connector
npm install
```

`npm install` also builds the project.

## 3. Add your settings

```bash
cp .env.example .env
```

Open `.env` in any text editor and fill in:

```ini
BD_CONNECTOR_MODE=sandbox
BD_CONNECTOR_BUSINESS_NAME=My Shop
BD_CONNECTOR_DASHBOARD_PASSWORD=choose-a-strong-password

# One gateway is enough to start, for example SSLCommerz:
SSLCOMMERZ_STORE_ID=your_sandbox_store_id
SSLCOMMERZ_STORE_PASSWORD=your_sandbox_store_password
```

Check what the connector sees:

```bash
npm run check
```

```
Mode: sandbox
Gateways set up: sslcommerz
SMS (BulkSMSBD): no
Public URL: not set (needed for payments)
...
```

## 4. Give the server a public address

After paying, the gateway sends the customer back to your server, so the server must be reachable from the internet.

**For testing on your own computer**, the free Cloudflare quick tunnel works well (no account needed):

```bash
# in a second terminal; install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
cloudflared tunnel --url http://localhost:8080
```

It prints an address like `https://random-words.trycloudflare.com`. Put it in `.env`:

```ini
BD_CONNECTOR_PUBLIC_URL=https://random-words.trycloudflare.com
```

The quick tunnel address changes each time you start it. For real use, see [step 8](#8-put-it-online).

## 5. Start the server

```bash
npm run serve
```

```
Flowthera BD Connector 0.3.0 (sandbox mode) listening on port 8080
Gateways: sslcommerz
Checkout page: https://random-words.trycloudflare.com/pay
Dashboard: https://random-words.trycloudflare.com/dashboard
```

## 6. Make a test payment

1. Open the checkout page (`/pay`). Enter an amount, a name and a mobile number, pick a gateway and press **Continue to payment**.
2. Pay on the gateway's test page. Each gateway's test numbers, PINs and cards are in the [gateway guide](gateways.md#testing).
3. You come back to a receipt that says **Payment successful**, with the amount and transaction ID.
4. Open `/dashboard` (any user name, your dashboard password). The payment is listed as **success**.

Try a cancelled payment too: start one and press cancel on the gateway page. It shows as **cancelled**.

### Payment links

You can share a link with the amount filled in:

```
https://your-address/pay?amount=1500&description=Invoice%2042&reference=INV-42&lock=1
```

| Parameter | Meaning |
|---|---|
| `amount` | Amount in taka |
| `lock=1` | The customer can't change the amount |
| `description` | Shown on the page and stored with the payment |
| `reference` | Your own invoice or order number, stored with the payment |
| `provider` | Pre-select a gateway: `bkash`, `nagad`, `sslcommerz`, `shurjopay`, `aamarpay` |
| `name`, `phone`, `email` | Pre-fill the customer's details |

## 7. Connect your own system (optional)

- **Get told about every payment:** set `BD_CONNECTOR_WEBHOOK_URL` and `BD_CONNECTOR_WEBHOOK_SECRET`. Your system receives a signed JSON message for each success, failure, cancellation and refund. See [API and webhooks](api.md#webhooks).
- **Start payments from your website or app:** set `BD_CONNECTOR_API_KEY` and call `POST /api/payments`. See [API and webhooks](api.md).
- **Send customers back to your own page:** set `BD_CONNECTOR_RETURN_URL`. See [the return redirect](api.md#the-return-redirect).
- **SMS:** add `BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID` and `SMS_OWNER_NUMBERS`. Customers get a receipt SMS after paying; you get an alert for every payment. See [SMS](data-reference.md#sms-messages).
- **Node.js project:** use the library directly. See [Node.js library](node-library.md).

## 8. Put it online

The server is a normal Node.js program. Any host that runs Node 20+ and keeps files between restarts will do: a VPS (DigitalOcean, Hetzner, a Bangladeshi host), Railway, Render, Fly.io, or your office server. It does not run on Cloudflare Workers or other serverless hosts that have no file system.

On a Linux VPS:

```bash
git clone https://github.com/Flowthera/bd-connector && cd bd-connector
npm install
cp .env.example .env   # fill it in, with BD_CONNECTOR_PUBLIC_URL=https://pay.your-shop.com
npm install -g pm2
pm2 start "npm run serve" --name payments
pm2 save && pm2 startup
```

Then point a domain (for example `pay.your-shop.com`) at the server with HTTPS, using Caddy, Nginx or Cloudflare Tunnel, forwarding to port 8080.

With Docker:

```bash
docker build -t bd-connector .
docker run -d --name payments --env-file .env -p 8080:8080 -v bd-data:/data bd-connector
```

Payment records are saved in `BD_CONNECTOR_DATA_DIR` (Docker: `/data`). Back up that folder.

## 9. Go live

1. Get live credentials from each gateway (this needs your trade license and a merchant agreement; see the [gateway guide](gateways.md)).
2. Some gateways ask for your callback or IP address during approval. Your callback addresses are `https://your-address/callback/<gateway>/...`.
3. Replace the sandbox keys in `.env` with the live ones and set `BD_CONNECTOR_MODE=live`.
4. Restart the server and make one small real payment (for example ৳10), then refund it.
5. Make sure `BD_CONNECTOR_PUBLIC_URL` uses `https://`, the dashboard password is strong, and the data folder is backed up.

## Troubleshooting

| You see | Fix |
|---|---|
| `set BD_CONNECTOR_PUBLIC_URL ...` | Set the public address (step 4) and restart. |
| `<gateway> is not set up` | That gateway's keys are missing in `.env`. Run `npm run check`. |
| `... is not a valid Bangladeshi mobile number` | Use an 11-digit number like `01712345678` (with or without `+88`). |
| The customer is stuck on "Payment not finished yet" | The gateway hasn't confirmed yet. Refresh later, or press **Check** in the dashboard. |
| `could not reach <host>` | The server can't reach the gateway. Check its internet access and firewall. |
| Webhook shows `ok: false` | Your webhook address didn't answer with a 2xx status. It is tried 3 times; see the payment's `notifications`. |
| SMS shows `dryRun: true` | Normal in sandbox mode. SMS are only sent in live mode. |
