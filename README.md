# Flowthera BD Connector

Free, open-source [MCP](https://modelcontextprotocol.io) connector that lets Claude and other AI agents take payments and send SMS in Bangladesh.

**Website:** https://bd-connector-flowthera.new-website.workers.dev/products/bd-connector/

Ask your agent things like *"Create a bKash payment link for ৳500 for invoice INV-1042"*, *"Make a Nagad payment link for order 2201"*, *"Has order T-88 been paid on SSLCommerz?"* or *"Text the customer that their order has shipped."*

> **Sandbox by default.** Out of the box it talks only to the bKash, Nagad and SSLCommerz test gateways and never sends SMS. Nothing moves real money until you set `BD_CONNECTOR_MODE=live` with your own merchant credentials.

## Tools

| Provider | Tool | What it does |
|---|---|---|
| — | `connector_status` | Shows the mode and which providers are configured |
| bKash | `bkash_create_payment` | Starts a payment and returns the link where the customer approves it |
| | `bkash_execute_payment` | Completes the payment after the customer approves |
| | `bkash_get_payment` | Looks up a payment's status |
| | `bkash_refund` | Full or partial refund |
| Nagad | `nagad_create_payment` | Starts a payment and returns the link where the customer pays |
| | `nagad_get_payment` | Confirms with Nagad whether the payment succeeded |
| SSLCommerz | `sslcommerz_create_payment` | Opens a hosted checkout (cards, mobile banking, net banking) |
| | `sslcommerz_get_payment` | Looks up a payment by your transaction id |
| | `sslcommerz_refund` | Requests a refund |
| | `sslcommerz_get_refund` | Checks a refund's status |
| BulkSMSBD | `sms_send` | Sends an SMS to one or more numbers (dry run in sandbox mode) |
| | `sms_balance` | Shows the remaining SMS balance |

Nagad refunds aren't included yet.

## Install

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Flowthera/bd-connector
cd bd-connector
npm install
npm run build
```

### Claude Desktop

Open **Settings → Developer → Edit Config** and add the connector to `claude_desktop_config.json`. Fill in only the providers you use:

```json
{
  "mcpServers": {
    "bd-connector": {
      "command": "node",
      "args": ["/full/path/to/bd-connector/dist/index.js"],
      "env": {
        "BD_CONNECTOR_MODE": "sandbox",
        "BKASH_APP_KEY": "...",
        "BKASH_APP_SECRET": "...",
        "BKASH_USERNAME": "...",
        "BKASH_PASSWORD": "...",
        "BKASH_CALLBACK_URL": "https://your-site.com/payment/done",
        "NAGAD_MERCHANT_ID": "...",
        "NAGAD_MERCHANT_NUMBER": "01XXXXXXXXX",
        "NAGAD_MERCHANT_PRIVATE_KEY": "...",
        "NAGAD_PUBLIC_KEY": "...",
        "NAGAD_CALLBACK_URL": "https://your-site.com/payment/done",
        "SSLCOMMERZ_STORE_ID": "...",
        "SSLCOMMERZ_STORE_PASSWORD": "...",
        "SSLCOMMERZ_SUCCESS_URL": "https://your-site.com/payment/done",
        "BULKSMSBD_API_KEY": "...",
        "BULKSMSBD_SENDER_ID": "..."
      }
    }
  }
}
```

Restart Claude Desktop, then ask: *"What's the BD connector status?"*

### Claude Code

```bash
claude mcp add bd-connector \
  -e BD_CONNECTOR_MODE=sandbox \
  -e SSLCOMMERZ_STORE_ID=... -e SSLCOMMERZ_STORE_PASSWORD=... \
  -e SSLCOMMERZ_SUCCESS_URL=https://your-site.com/payment/done \
  -- node /full/path/to/bd-connector/dist/index.js
```

Every setting is listed in [`.env.example`](.env.example).

## Getting test credentials

- **SSLCommerz:** register a free sandbox store at [developer.sslcommerz.com](https://developer.sslcommerz.com/registration/). Your store id and password arrive by email.
- **bKash:** sandbox credentials for Tokenized Checkout come from bKash's developer portal or your bKash merchant contact. In the sandbox, approve payments with OTP `123456` and PIN `12121`.
- **Nagad:** sandbox access comes from Nagad's merchant team when you apply for the payment gateway. They give you a merchant ID and Nagad's public key; you create your own key pair and register the public half with them. Keys can be pasted as PEM or as the bare base64 the portal shows.
- **BulkSMSBD:** create an account at [bulksmsbd.net](https://bulksmsbd.net) for an API key and sender ID. In sandbox mode `sms_send` never calls the gateway, so you can try it without credit.

## How a payment works

1. The agent calls `bkash_create_payment`, `nagad_create_payment` or `sslcommerz_create_payment` and gets a `paymentUrl`.
2. The customer opens the link and pays.
3. For bKash, the agent calls `bkash_execute_payment` to complete it. For Nagad and SSLCommerz, it calls `nagad_get_payment` or `sslcommerz_get_payment` to confirm.

Tools that move money or send SMS are marked as destructive, so clients like Claude ask before running them.

## Safety

- Keys stay in your own environment. They are never logged or returned by any tool.
- Sandbox is the default, and live mode must be switched on explicitly.
- Run your own tests in sandbox mode before going live.

## Development

```bash
npm test
```

Tests use a fake network, so they need no credentials. Contributions are welcome: open an issue or pull request.

## Hosted version

Don't want to run it yourself? Flowthera offers a hosted, supported version for businesses in Bangladesh at [bd.flowthera.com](https://bd.flowthera.com).

## License

[MIT](LICENSE) © Flowthera Infotech. Powered by [Flowthera](https://flowthera.com).
