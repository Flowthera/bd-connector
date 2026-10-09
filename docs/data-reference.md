# Payment data reference

Every payment is one record with the same fields, whichever gateway was used. You get this record from the [API](api.md), from [webhooks](api.md#webhooks), from the [Node.js library](node-library.md) and from the Claude tools.

## Statuses

| Status | Meaning | Money taken? |
|---|---|---|
| `pending` | Created; the customer hasn't finished, or the gateway hasn't confirmed yet. | Not yet |
| `success` | The gateway confirmed the payment and the amount matches. | Yes |
| `failed` | The payment was declined or failed, or the paid amount didn't match the order. | No |
| `cancelled` | The customer cancelled on the gateway's page. | No |
| `refunded` | A successful payment was fully refunded. Partial refunds keep `success` and are listed in `refunds`. | Returned |

`paid` is `true` only when the status is `success`. Only `success`, `failed`, `cancelled` and `refunded` are final; `pending` can still change. A payment that stays `pending` usually means the customer closed the page: check it again later or leave it.

## The payment record

```json
{
  "orderId": "BDMV17GQHEED9TGK",
  "reference": "INV-1001",
  "provider": "bkash",
  "mode": "sandbox",
  "status": "success",
  "paid": true,
  "amount": 1250,
  "paidAmount": 1250,
  "currency": "BDT",
  "description": "Order INV-1001",
  "customer": {
    "name": "Rahim Uddin",
    "phone": "01712345678",
    "email": "rahim@example.com"
  },
  "transactionId": "BKA7Q2XYZ",
  "gatewayReference": "TR0011abc123",
  "gateway": { "paymentID": "TR0011abc123", "trxID": "BKA7Q2XYZ" },
  "method": "bKash",
  "message": "bKash status: Completed",
  "metadata": { "plan": "gold" },
  "paymentUrl": "https://sandbox.payment.bkash.com/...",
  "createdAt": "2026-10-09T10:15:02.120Z",
  "updatedAt": "2026-10-09T10:16:40.884Z",
  "paidAt": "2026-10-09T10:16:40.884Z",
  "refunds": [],
  "notifications": [
    { "kind": "webhook", "to": "https://your-shop.com/hooks/payments", "event": "payment.success", "ok": true, "at": "2026-10-09T10:16:41.020Z" },
    { "kind": "sms", "to": "01712345678", "event": "payment.success", "ok": true, "dryRun": true, "at": "2026-10-09T10:16:41.030Z" }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `orderId` | string | The connector's id for this payment: 16 letters and digits, unique. Use it to look the payment up. |
| `reference` | string or null | Your own order or invoice number, as you sent it. |
| `provider` | string | `bkash`, `nagad`, `sslcommerz`, `shurjopay` or `aamarpay`. |
| `mode` | string | `sandbox` or `live`, the mode when the payment was made. |
| `status` | string | See [statuses](#statuses). |
| `paid` | boolean | `true` only for `success`. The simplest field to check. |
| `amount` | number | The amount you asked for, in taka. |
| `paidAmount` | number or null | The amount the gateway reported. Set once the gateway has answered. |
| `currency` | string | Always `BDT`. |
| `description` | string | What the payment is for. Defaults to the reference or "Order &lt;orderId&gt;". |
| `customer.name` | string | Customer's name. |
| `customer.phone` | string | Customer's mobile number, normalized to `01XXXXXXXXX`. Receives the receipt SMS. |
| `customer.email` | string | Optional. |
| `customer.address`, `customer.city` | string | Optional; passed to gateways that use them. |
| `transactionId` | string or null | The transaction ID the customer sees (bKash/Nagad TrxID, bank transaction ID). Set on success. |
| `gatewayReference` | string or null | The gateway's own id for the payment session (bKash `paymentID`, Nagad `paymentRefId`, SSLCommerz `sessionkey`, shurjoPay `sp_order_id`). |
| `gateway` | object | Raw gateway ids the connector needs for lookups and refunds. |
| `method` | string or null | How the customer paid when the gateway says (for example `bKash`, `Rocket`, `VISA`). |
| `message` | string or null | The gateway's last status message, or why a payment failed. |
| `metadata` | object | Your own string key-value pairs, stored and returned as sent. |
| `paymentUrl` | string | The gateway page to send the customer to. |
| `createdAt`, `updatedAt` | string | ISO 8601 times (UTC). |
| `paidAt` | string or null | When the connector confirmed the payment (UTC). |
| `refunds[]` | array | Each refund: `amount`, `status`, `reference` (gateway refund id), `createdAt`. |
| `notifications[]` | array | Each webhook and SMS sent for this payment: `kind`, `to`, `event`, `ok`, `dryRun`, `error`, `at`. |

## Events

| Event | When |
|---|---|
| `payment.success` | A payment was confirmed. |
| `payment.failed` | A payment failed or the amount didn't match. |
| `payment.cancelled` | The customer cancelled. |
| `payment.refunded` | A refund was made (full or partial). |

Each event is sent once, when the status changes. Repeated callbacks from a gateway don't send it again.

## Webhook message

`POST` to `BD_CONNECTOR_WEBHOOK_URL`, `Content-Type: application/json`:

```json
{
  "event": "payment.success",
  "sentAt": "2026-10-09T10:16:41.010Z",
  "payment": { "...": "the full payment record above" }
}
```

| Header | Meaning |
|---|---|
| `X-BD-Event` | The event name. |
| `X-BD-Signature` | `sha256=` + HMAC-SHA256 of the raw body with `BD_CONNECTOR_WEBHOOK_SECRET`. Only sent when a secret is set. |

Your endpoint should answer with any 2xx status. Otherwise the connector tries again after 5 seconds and 30 seconds. How to check the signature: [API and webhooks](api.md#checking-the-signature).

## Return redirect

When `BD_CONNECTOR_RETURN_URL` is set, the customer is sent there after the gateway with these query parameters:

| Parameter | Meaning |
|---|---|
| `order_id` | The connector's `orderId`. |
| `reference` | Your reference, when you gave one. |
| `status` | `success`, `failed`, `cancelled` or `pending`. |
| `amount` | The order amount. |
| `transaction_id` | Set on success. |
| `sig` | HMAC-SHA256 hex of `<order_id>.<status>` with `BD_CONNECTOR_WEBHOOK_SECRET` (or the API key when no secret is set). |

## SMS messages

| Message | Sent to | When | Default text |
|---|---|---|---|
| Customer receipt | The customer's phone | `payment.success` (if `SMS_NOTIFY_CUSTOMER` is on) | `{business}: payment of Tk {amount} received for order {orderId}. Trx ID {transactionId}. Thank you!` |
| Owner: paid | `SMS_OWNER_NUMBERS` | `payment.success` | `Paid: Tk {amount} by {customerName} {customerPhone} via {provider}. Order {orderId}, Trx {transactionId}.` |
| Owner: not paid | `SMS_OWNER_NUMBERS` | `payment.failed`, `payment.cancelled` | `Payment {status}: Tk {amount} by {customerName} {customerPhone} via {provider}. Order {orderId}.` |

Placeholders: `{business}`, `{amount}`, `{orderId}`, `{reference}` (your reference, or the orderId), `{transactionId}`, `{provider}`, `{customerName}`, `{customerPhone}`, `{status}`.

Bangla text works; for example `SMS_TEMPLATE_CUSTOMER_SUCCESS={business}: ৳{amount} পেমেন্ট পেয়েছি। ট্রানজেকশন আইডি {transactionId}। ধন্যবাদ!` Unicode SMS use more credit per message.

## Errors

API errors are JSON: `{ "error": "message", "code": "short_code" }`. Common codes:

| Code | Meaning |
|---|---|
| `not_configured` | That gateway's keys aren't set. |
| `missing_public_url` | `BD_CONNECTOR_PUBLIC_URL` isn't set. |
| `invalid_amount` | Amount is missing, zero, negative, or below the gateway's minimum (SSLCommerz: 10). |
| `invalid_number` | The phone number isn't a Bangladeshi mobile number. |
| `missing_customer` | `customer.name` is missing. |
| `unknown_provider` | The gateway name isn't one of the five. |
| `not_found` | No payment with that `orderId`. |
| `not_refundable`, `refund_not_supported` | The payment isn't successful, or the gateway's refunds are made in its own panel. |
| `network_error` | The gateway couldn't be reached. |
| Gateway codes | Other codes come from the gateway itself, with its message. |
