# Configuration

Every setting is an environment variable. The command line also reads a `.env` file in the folder you run it from; values already set in the environment win. In Node.js you can pass settings with `new BdConnector({ env: {...} })`.

Empty values count as not set.

## Mode

| Variable | Default | Meaning |
|---|---|---|
| `BD_CONNECTOR_MODE` | `sandbox` | `sandbox` uses the gateways' test systems and never sends SMS. `live` moves real money and sends real SMS. |
| `BD_CONNECTOR_TIMEOUT_MS` | `30000` | How long to wait for a gateway before giving up. |

## Payment server

| Variable | Default | Meaning |
|---|---|---|
| `BD_CONNECTOR_PUBLIC_URL` | none | **Required to take payments.** The public `https://` address of the server, for example `https://pay.your-shop.com`. If you mount the connector under a path in your own app, include the path: `https://your-shop.com/payments`. |
| `BD_CONNECTOR_PORT` | `8080` (or `PORT`) | Port for `bd-connector serve`. |
| `BD_CONNECTOR_BUSINESS_NAME` | `Our shop` | Shown on the checkout page, receipts and SMS. |
| `BD_CONNECTOR_RETURN_URL` | none | Where customers go after a payment. Without it they see the built-in receipt. See [the return redirect](api.md#the-return-redirect). |
| `BD_CONNECTOR_WEBHOOK_URL` | none | Your system's address that receives payment results. See [webhooks](api.md#webhooks). |
| `BD_CONNECTOR_WEBHOOK_SECRET` | none | Secret for signing webhooks and the return redirect. Use 32+ random characters, for example from `openssl rand -hex 32`. |
| `BD_CONNECTOR_API_KEY` | none | Turns on the [JSON API](api.md). Callers send `Authorization: Bearer <key>`. Off when empty. |
| `BD_CONNECTOR_DASHBOARD_PASSWORD` | none | Turns on the dashboard at `/dashboard`. Off when empty. |
| `BD_CONNECTOR_CHECKOUT_PAGE` | `on` | The public checkout page at `/pay`. Set `off` if you only start payments from your own system. |
| `BD_CONNECTOR_DATA_DIR` | `~/.bd-connector` | Folder for `payments.json`, the payment records. Back it up. |

## SMS (BulkSMSBD)

| Variable | Default | Meaning |
|---|---|---|
| `BULKSMSBD_API_KEY` | none | API key from bulksmsbd.net. |
| `BULKSMSBD_SENDER_ID` | none | Your approved sender ID. Needed to send. |
| `SMS_NOTIFY_CUSTOMER` | `on` | Send the customer a receipt SMS after a successful payment. |
| `SMS_OWNER_NUMBERS` | none | Your own numbers, comma separated, for an alert on every success, failure and cancellation. |
| `SMS_TEMPLATE_CUSTOMER_SUCCESS` | see below | Receipt text for the customer. |
| `SMS_TEMPLATE_OWNER_SUCCESS` | see below | Your alert for a successful payment. |
| `SMS_TEMPLATE_OWNER_FAILED` | see below | Your alert for a failed or cancelled payment. |

Default texts and placeholders are in the [data reference](data-reference.md#sms-messages). SMS are sent only in live mode; in sandbox they are recorded as `dryRun`.

## Gateways

Set all required values for a gateway to turn it on. Where to get them: [gateway guide](gateways.md).

| Gateway | Required | Optional |
|---|---|---|
| bKash | `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` | `BKASH_CALLBACK_URL` |
| Nagad | `NAGAD_MERCHANT_ID`, `NAGAD_MERCHANT_NUMBER`, `NAGAD_MERCHANT_PRIVATE_KEY`, `NAGAD_PUBLIC_KEY` | `NAGAD_CALLBACK_URL` |
| SSLCommerz | `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` | `SSLCOMMERZ_SUCCESS_URL`, `SSLCOMMERZ_FAIL_URL`, `SSLCOMMERZ_CANCEL_URL` |
| shurjoPay | `SHURJOPAY_USERNAME`, `SHURJOPAY_PASSWORD` | `SHURJOPAY_PREFIX` (default `SP`), `SHURJOPAY_RETURN_URL` |
| aamarPay | `AAMARPAY_STORE_ID`, `AAMARPAY_SIGNATURE_KEY` | `AAMARPAY_SUCCESS_URL`, `AAMARPAY_FAIL_URL`, `AAMARPAY_CANCEL_URL` |

The optional callback and return URLs are only used by the single-gateway Claude tools (such as `bkash_create_payment`). The payment server and `payment_create` build their own callback addresses from `BD_CONNECTOR_PUBLIC_URL`.

Nagad keys can be pasted as PEM (with `\n` for line breaks) or as the bare base64 text the Nagad portal shows.

## Checking your settings

```bash
npm run check
```

prints the mode, which gateways are on, and whether the API, dashboard, webhook and SMS are set up. It never prints keys.
