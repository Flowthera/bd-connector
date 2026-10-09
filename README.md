# Flowthera BD Connector

Free, open-source payment and SMS system for Bangladesh. Take payments with **bKash, Nagad, Rocket, Upay, cards and net banking**, get a clear **success or failed** result with the amount, customer and transaction ID, and let your customers and yourself know by **SMS**.

Use it the way that suits you:

| You want to... | Use | Guide |
|---|---|---|
| Take payments without writing code | The ready payment server: a checkout page, receipts and a dashboard | [Setup guide](docs/setup-guide.md) |
| Add payments to your website or app (any language) | The payment server's JSON API and webhooks | [API and webhooks](docs/api.md) |
| Add payments inside your Node.js project | The library: `import { BdConnector } from "@flowthera/bd-connector"` | [Node.js library](docs/node-library.md) |
| Let Claude or another AI agent take payments | The MCP connector | [Claude setup](docs/claude.md) |

**Website:** https://bd-connector-flowthera.new-website.workers.dev/products/bd-connector/

> **Sandbox by default.** Out of the box it only talks to the gateways' test systems and never sends real SMS. Nothing moves real money until you set `BD_CONNECTOR_MODE=live` with your own merchant credentials.

## How a payment works

```
Your site / Claude / checkout page
        │  1. create payment (amount, customer, gateway)
        ▼
  BD Connector ──────────────► Gateway (bKash, Nagad, SSLCommerz, shurjoPay, aamarPay)
        ▲   2. customer pays on the gateway's page     │
        │   3. gateway sends the customer back ◄────────┘
        │   4. connector confirms the result with the gateway (never trusts the redirect)
        ▼
  5. Result saved: success / failed / cancelled, amount, customer, transaction ID
  6. Your system is told: signed webhook, event in Node.js, redirect to your page
  7. SMS: receipt to the customer, alert to you
```

## Gateways

| Gateway | Customers can pay with | Refunds from the connector |
|---|---|---|
| bKash | bKash | Yes |
| Nagad | Nagad | No (use the Nagad panel) |
| SSLCommerz | Cards, bKash, Nagad, Rocket, Upay, net banking | Yes |
| shurjoPay | bKash, Nagad, Rocket, Upay, cards, net banking | No (use the shurjoPay panel) |
| aamarPay | bKash, Nagad, Rocket, Upay, cards | No (use the aamarPay panel) |

Rocket and Upay have no open merchant API of their own, so they come through SSLCommerz, shurjoPay or aamarPay. SMS goes through [BulkSMSBD](https://bulksmsbd.net). How to get each gateway's test and live keys: [gateway guide](docs/gateways.md).

## Quick start (5 minutes, sandbox)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/Flowthera/bd-connector
cd bd-connector
npm install
cp .env.example .env      # then fill in at least one gateway's sandbox keys
npm run serve
```

Open http://localhost:8080/pay to see the checkout page. For gateways to send customers back, the server needs a public address; the [setup guide](docs/setup-guide.md) shows a free way to get one for testing and how to put it online.

## Docs

- [Setup guide](docs/setup-guide.md): from zero to your first test payment, then going live
- [Configuration](docs/configuration.md): every setting
- [Payment data reference](docs/data-reference.md): every field, status, webhook and SMS template
- [API and webhooks](docs/api.md): connect any website or app
- [Node.js library](docs/node-library.md): use it inside your own project (Express example included)
- [Claude setup](docs/claude.md): all MCP tools
- [Gateways](docs/gateways.md): getting keys and testing each gateway

## Safety

- The result of every payment is checked with the gateway itself. A paid amount that differs from the order is never marked as paid.
- Webhooks are signed (HMAC-SHA256), and the redirect to your site carries a signature too.
- Keys stay in your own environment and are never logged or returned.
- The JSON API and dashboard are off until you set a key and a password.
- Sandbox is the default. Live mode must be switched on explicitly.

## Development

```bash
npm test
```

Tests use a fake network, so they need no credentials. Contributions are welcome: open an issue or pull request.

## Hosted version

Don't want to run it yourself? Flowthera offers a hosted, supported version for businesses in Bangladesh at [bd.flowthera.com](https://bd.flowthera.com).

## License

[MIT](LICENSE) © Flowthera Infotech. Powered by [Flowthera](https://flowthera.com).
