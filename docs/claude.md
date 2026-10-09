# Claude setup

The connector is also an [MCP](https://modelcontextprotocol.io) server, so Claude (and other MCP clients) can take payments, check them, and send SMS for you.

Ask things like:

- *"Make a bKash payment link for ৳1,250 for Rahim, 01712345678, invoice INV-1001."*
- *"Has order BDMV17GQHEED9TGK been paid?"*
- *"Show me today's successful payments and the total."*
- *"Refund ৳500 of order BDMV17GQHEED9TGK, item out of stock."*
- *"Text 01712345678 that their order has shipped."*

## Install

```bash
git clone https://github.com/Flowthera/bd-connector
cd bd-connector
npm install
```

### Claude Desktop

Open **Settings → Developer → Edit Config** and add the connector to `claude_desktop_config.json`. Put in only what you use:

```json
{
  "mcpServers": {
    "bd-connector": {
      "command": "node",
      "args": ["/full/path/to/bd-connector/dist/index.js"],
      "env": {
        "BD_CONNECTOR_MODE": "sandbox",
        "BD_CONNECTOR_PUBLIC_URL": "https://pay.your-shop.com",
        "BD_CONNECTOR_DATA_DIR": "/full/path/to/payment-records",
        "BKASH_APP_KEY": "...",
        "BKASH_APP_SECRET": "...",
        "BKASH_USERNAME": "...",
        "BKASH_PASSWORD": "...",
        "SSLCOMMERZ_STORE_ID": "...",
        "SSLCOMMERZ_STORE_PASSWORD": "...",
        "BULKSMSBD_API_KEY": "...",
        "BULKSMSBD_SENDER_ID": "..."
      }
    }
  }
}
```

Restart Claude Desktop and ask: *"What's the BD connector status?"*

### Claude Code

```bash
claude mcp add bd-connector \
  -e BD_CONNECTOR_MODE=sandbox \
  -e BD_CONNECTOR_PUBLIC_URL=https://pay.your-shop.com \
  -e SSLCOMMERZ_STORE_ID=... -e SSLCOMMERZ_STORE_PASSWORD=... \
  -- node /full/path/to/bd-connector/dist/index.js
```

## Two ways Claude can take payments

**With the payment server (recommended).** Run `bd-connector serve` somewhere public ([setup guide](setup-guide.md)) and give Claude the same `BD_CONNECTOR_PUBLIC_URL` and `BD_CONNECTOR_DATA_DIR` (when both run on the same machine). Then `payment_create` works with every gateway, the server confirms each payment when the customer returns, sends your webhook and SMS, and `payments_list` shows everything in one place.

**Gateway tools only.** Without a server, Claude can still use each gateway's own tools (`bkash_create_payment` and so on). Set that gateway's callback or success URL, and ask Claude to check or complete the payment afterwards.

## Tools

| Tool | What it does |
|---|---|
| `connector_status` | Mode, which gateways are set up, and payment-system settings |
| `payment_create` | Start a payment with any gateway; returns the record with `paymentUrl` |
| `payment_check` | Ask the gateway for the latest result of a payment |
| `payments_list` | List payments with totals; filter by status or search |
| `payment_refund` | Refund a bKash or SSLCommerz payment by order id |
| `bkash_create_payment`, `bkash_execute_payment`, `bkash_get_payment`, `bkash_refund` | bKash directly |
| `nagad_create_payment`, `nagad_get_payment` | Nagad directly |
| `sslcommerz_create_payment`, `sslcommerz_get_payment`, `sslcommerz_refund`, `sslcommerz_get_refund` | SSLCommerz directly |
| `shurjopay_create_payment`, `shurjopay_get_payment` | shurjoPay directly |
| `aamarpay_create_payment`, `aamarpay_get_payment` | aamarPay directly |
| `sms_send`, `sms_balance` | BulkSMSBD (sending is a dry run in sandbox mode) |

Tools that move money or send SMS are marked as destructive, so Claude asks before running them.

The records Claude returns use the fields in the [data reference](data-reference.md).
