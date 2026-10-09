# Node.js library

Use the connector inside your own Node.js project (Express, Fastify, Next.js API routes, NestJS, plain `node:http`). Node 20 or newer.

## Install

The package isn't on the npm registry yet. Install it straight from GitHub:

```bash
npm install github:Flowthera/bd-connector
```

## The short version

```js
import express from "express";
import { BdConnector, createHandler } from "@flowthera/bd-connector";

// Reads the same settings as the server (process.env); see docs/configuration.md.
// BD_CONNECTOR_PUBLIC_URL must be the public address of the mount point below,
// for example https://your-shop.com/payments
const bd = new BdConnector();

bd.on("payment.success", async (payment) => {
  // payment.reference = your order number, payment.amount, payment.customer, payment.transactionId
  await markOrderPaid(payment.reference, payment.transactionId);
});
bd.on("payment.failed", async (payment) => {
  await markOrderFailed(payment.reference, payment.message);
});

const app = express();

// Gateway callbacks, receipts, checkout page, API and dashboard. Mount it before body parsers.
app.use("/payments", createHandler(bd));

app.use(express.json());
app.post("/checkout", async (req, res) => {
  const payment = await bd.createPayment({
    provider: req.body.method,            // "bkash", "nagad", "sslcommerz", "shurjopay" or "aamarpay"
    amount: req.body.total,
    customer: { name: req.body.name, phone: req.body.phone },
    reference: req.body.orderNumber,
  });
  res.json({ redirectTo: payment.paymentUrl });
});

app.listen(3000);
```

That's the whole cycle: the customer pays, comes back to `/payments/callback/...`, the connector confirms it with the gateway, saves it, runs your `payment.success` listener, sends the SMS, and sends the customer to your `BD_CONNECTOR_RETURN_URL` or a receipt page.

A runnable version is in [examples/express](../examples/express).

## `new BdConnector(options?)`

| Option | Default | Meaning |
|---|---|---|
| `env` | `process.env` | Settings as an object, with the same names as [configuration](configuration.md). |
| `config` | from `env` | A ready config from `loadConfig(env)`. |
| `store` | `FileStore` in `BD_CONNECTOR_DATA_DIR` | Where payments are kept. See [your own database](#your-own-database). |
| `fetch` | global `fetch` | For tests or proxies. |
| `webhookRetryDelaysMs` | `[0, 5000, 30000]` | Waits between webhook attempts. |

```js
const bd = new BdConnector({
  env: {
    BD_CONNECTOR_MODE: "sandbox",
    BD_CONNECTOR_PUBLIC_URL: "https://your-shop.com/payments",
    SSLCOMMERZ_STORE_ID: "...",
    SSLCOMMERZ_STORE_PASSWORD: "...",
  },
});
```

## Methods

| Method | Returns | What it does |
|---|---|---|
| `createPayment(input)` | `Payment` | Starts a payment. Input: `provider`, `amount`, `customer { name, phone, email?, address?, city? }`, `description?`, `reference?`, `metadata?`. Send the customer to `paymentUrl`. |
| `handleCallback(provider, orderId, params)` | `Payment` | Confirms a payment when the gateway sends the customer back. `createHandler` calls this for you; call it yourself only if you write your own callback route. `params` are the query and form fields. |
| `verifyPayment(orderId)` | `Payment` | Asks the gateway for the latest result. Safe to call any time. |
| `getPayment(orderId)` | `Payment` or `undefined` | Reads the saved record. |
| `listPayments({ status?, provider?, search?, limit? })` | `Payment[]` | Newest first. |
| `refundPayment(orderId, amount?, reason?)` | `Payment` | bKash and SSLCommerz. No amount means the full remaining amount. |
| `on(event, listener)` | `this` | `payment.success`, `payment.failed`, `payment.cancelled`, `payment.refunded`, or `payment.*` for all. The listener gets `(payment, event)`. |
| `callbackUrl(provider, orderId)` | `string` | The address the gateway returns to. |
| `providers()` | `string[]` | Gateways that are set up. |
| `flush()` | `Promise` | Waits for webhooks, SMS and listeners still running. Call before your process exits. |

Every method that talks to a gateway throws a `ProviderError` with `message` and `code` on failure. The [payment record](data-reference.md#the-payment-record) and statuses are the same everywhere.

Gateway clients are also available for direct use: `bd.bkash`, `bd.nagad`, `bd.sslcommerz`, `bd.shurjopay`, `bd.aamarpay` and `bd.sms` (for example `await bd.sms.send(["01712345678"], "Your order has shipped")`).

## Other exports

| Export | Use |
|---|---|
| `createHandler(bd)` | A `(req, res)` handler for Express, Connect, Fastify (`@fastify/middie`) or `node:http`. |
| `startServer(bd, port?)` | Runs the handler as its own server. |
| `verifyWebhookSignature(body, header, secret)` | Checks a webhook's `X-BD-Signature`. |
| `signReturn(orderId, status, secret)` | The `sig` on the return redirect. |
| `summarize(payments)` | Totals, as in `/api/summary`. |
| `normalizeNumber(phone)` | `+880 1712-345678` → `8801712345678`; throws on invalid numbers. |
| `createMcpServer(bd)` | The Claude (MCP) server, if you want to host it yourself. |
| `MemoryStore`, `FileStore` | Built-in stores. |

TypeScript types are included (`Payment`, `PaymentStatus`, `Provider`, `CreatePaymentInput` and more).

## Your own database

By default payments are saved in one JSON file, which is fine for thousands of payments on one server. To use your database, pass any object with three methods:

```js
const store = {
  async get(orderId) {
    const row = await db.query("select data from payments where order_id = $1", [orderId]);
    return row?.data;
  },
  async put(payment) {
    await db.query(
      "insert into payments (order_id, data) values ($1, $2) on conflict (order_id) do update set data = $2",
      [payment.orderId, payment],
    );
  },
  async list({ status, limit = 100 } = {}) {
    // return newest first, filtered by status when given
  },
};
const bd = new BdConnector({ store });
```

## Without Express

```js
import { createServer } from "node:http";
import { BdConnector, createHandler } from "@flowthera/bd-connector";

const bd = new BdConnector();
createServer(createHandler(bd)).listen(8080);
```

For Next.js and other frameworks without a Node `(req, res)` handler, run the payment server separately (`bd-connector serve`) and use the [API and webhooks](api.md).
