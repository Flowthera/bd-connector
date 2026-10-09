# API and webhooks

Connect any website or app (PHP, Laravel, WordPress, Python, Node.js, mobile apps) to the payment server. Your system starts payments with the JSON API and hears about results through webhooks.

Turn the API on by setting `BD_CONNECTOR_API_KEY`, and send it with every request:

```
Authorization: Bearer <BD_CONNECTOR_API_KEY>
```

Keep the key on your server. Never put it in a web page or mobile app; call the API from your back end.

## The flow

1. Your back end calls `POST /api/payments` with the amount and customer.
2. You send the customer to the `paymentUrl` in the reply.
3. The customer pays and the gateway sends them back to the connector, which confirms the result with the gateway.
4. The connector sends a webhook to your system and sends the customer to your `BD_CONNECTOR_RETURN_URL` (or its own receipt page).
5. Your system marks the order paid when the webhook says `payment.success`.

Treat the webhook (or a `GET /api/payments/{orderId}` lookup) as the truth. The return redirect is for showing the customer a page.

## Endpoints

| Method and path | What it does |
|---|---|
| `POST /api/payments` | Start a payment |
| `GET /api/payments/{orderId}` | Get one payment |
| `POST /api/payments/{orderId}/verify` | Ask the gateway for the latest result and update the record |
| `POST /api/payments/{orderId}/refund` | Refund a bKash or SSLCommerz payment |
| `GET /api/payments` | List payments |
| `GET /api/summary` | Totals |
| `GET /api/providers` | Mode and gateways that are set up |
| `GET /health` | `{ "ok": true, ... }`, no key needed |

### Start a payment

```bash
curl -X POST https://pay.your-shop.com/api/payments \
  -H "Authorization: Bearer $BD_CONNECTOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "bkash",
    "amount": 1250,
    "customer": { "name": "Rahim Uddin", "phone": "01712345678", "email": "rahim@example.com" },
    "description": "2 books",
    "reference": "INV-1001",
    "metadata": { "userId": "42" }
  }'
```

| Field | Required | Meaning |
|---|---|---|
| `provider` | yes | `bkash`, `nagad`, `sslcommerz`, `shurjopay` or `aamarpay` |
| `amount` | yes | Taka, up to 2 decimals. SSLCommerz minimum is 10. |
| `customer.name` | yes | |
| `customer.phone` | yes | Bangladeshi mobile number, any common format |
| `customer.email`, `customer.address`, `customer.city` | no | |
| `description` | no | What the payment is for |
| `reference` | no | Your order or invoice number |
| `metadata` | no | Your own string key-value pairs, returned in webhooks |

Reply `201` with the [payment record](data-reference.md#the-payment-record). Send the customer to `paymentUrl`.

### List payments

`GET /api/payments?status=success&provider=bkash&search=01712345678&limit=50`

All filters are optional. `search` matches the order id, reference, customer name, phone, email and transaction ID. Newest first.

### Refund

```bash
curl -X POST https://pay.your-shop.com/api/payments/BDMV17GQHEED9TGK/refund \
  -H "Authorization: Bearer $BD_CONNECTOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "amount": 500, "reason": "Item out of stock" }'
```

Leave out `amount` to refund everything that's left. Works for bKash and SSLCommerz; refund other gateways from their merchant panel.

### Summary

```json
{
  "count": 42,
  "byStatus": { "success": { "count": 30, "amount": 45200 }, "pending": { "count": 5, "amount": 3100 }, "failed": { "count": 4, "amount": 2000 }, "cancelled": { "count": 3, "amount": 900 }, "refunded": { "count": 0, "amount": 0 } },
  "receivedToday": 5200,
  "receivedTotal": 45200
}
```

"Today" is the calendar day in Dhaka.

## Webhooks

Set `BD_CONNECTOR_WEBHOOK_URL` to an address on your system and `BD_CONNECTOR_WEBHOOK_SECRET` to a long random secret. For each `payment.success`, `payment.failed`, `payment.cancelled` and `payment.refunded`, the connector sends:

```
POST https://your-shop.com/hooks/payments
Content-Type: application/json
X-BD-Event: payment.success
X-BD-Signature: sha256=5d1c...

{ "event": "payment.success", "sentAt": "...", "payment": { ...payment record... } }
```

Answer with any 2xx status. A failed delivery is tried again after 5 and 30 seconds, and every attempt's result is saved in the payment's `notifications`.

Webhooks can arrive more than once (for example after a retry), so make your handler safe to run twice: check whether the order is already marked paid.

### Checking the signature

Always check `X-BD-Signature` against the **raw** request body before trusting a webhook.

Node.js:

```js
import { verifyWebhookSignature } from "@flowthera/bd-connector";

app.post("/hooks/payments", express.raw({ type: "application/json" }), (req, res) => {
  const body = req.body.toString("utf8");
  if (!verifyWebhookSignature(body, req.get("X-BD-Signature"), process.env.BD_CONNECTOR_WEBHOOK_SECRET)) {
    return res.status(401).end();
  }
  const { event, payment } = JSON.parse(body);
  if (event === "payment.success") {
    // mark payment.reference (your order) as paid; payment.amount, payment.customer, payment.transactionId
  }
  res.sendStatus(200);
});
```

PHP:

```php
<?php
$body = file_get_contents('php://input');
$expected = 'sha256=' . hash_hmac('sha256', $body, getenv('BD_CONNECTOR_WEBHOOK_SECRET'));
if (!hash_equals($expected, $_SERVER['HTTP_X_BD_SIGNATURE'] ?? '')) {
    http_response_code(401);
    exit;
}
$data = json_decode($body, true);
if ($data['event'] === 'payment.success') {
    $p = $data['payment'];
    // mark $p['reference'] as paid: $p['amount'], $p['customer']['phone'], $p['transactionId']
}
http_response_code(200);
```

Python:

```python
import hmac, hashlib, os, json

def is_valid(body: bytes, signature: str) -> bool:
    expected = "sha256=" + hmac.new(os.environ["BD_CONNECTOR_WEBHOOK_SECRET"].encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature or "")
```

## The return redirect

With `BD_CONNECTOR_RETURN_URL=https://your-shop.com/payment-result`, the customer lands on:

```
https://your-shop.com/payment-result?order_id=BDMV17GQHEED9TGK&reference=INV-1001&status=success&amount=1250&transaction_id=BKA7Q2XYZ&sig=9f2c...
```

To trust `status` without calling the API, compare `sig` with HMAC-SHA256 hex of `order_id + "." + status` using your webhook secret:

```php
$ok = hash_equals(hash_hmac('sha256', $_GET['order_id'] . '.' . $_GET['status'], getenv('BD_CONNECTOR_WEBHOOK_SECRET')), $_GET['sig'] ?? '');
```

```js
import { signReturn } from "@flowthera/bd-connector";
const ok = signReturn(q.order_id, q.status, process.env.BD_CONNECTOR_WEBHOOK_SECRET) === q.sig;
```

## Gateway callbacks

The connector handles these addresses itself; you don't call them. They're listed here for gateway approval forms and firewalls:

```
GET|POST /callback/{provider}/{orderId}
```

You don't need SSLCommerz's optional IPN setting: the connector confirms every payment with the gateway when the customer returns, and you can re-check a `pending` payment at any time with `POST /api/payments/{orderId}/verify` or the dashboard's **Check** button.
