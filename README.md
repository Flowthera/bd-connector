# Flowthera BD Connector

[![M8ven Score](https://m8ven.ai/badge/mcp/flowthera-bd-connector-g9g8t7?v=5eaf0c47cbc4afa5103d15e3e8d26bd0)](https://m8ven.ai/mcp/flowthera-bd-connector-g9g8t7?s=readme)

Free, open-source payment and SMS system for Bangladesh. Take payments with **bKash, Nagad, Rocket, Upay, cards and net banking**, get a clear **success or failed** result with the amount, customer and transaction ID, and let your customers and yourself know by **SMS**.

Use it the way that suits you:

| You want to... | Use | Guide |
|---|---|---|
| Take payments without writing code | The ready payment server: payment links, a checkout page, receipts and a dashboard | [Setup guide](docs/setup-guide.md) |
| Put a Pay button on any website (WordPress, Shopify, Wix, HTML) | Two lines of code, no back end | [Add to any website](docs/website-integration.md) |
| Connect your website, app, CRM or accounts (any language) | The JSON API, signed webhooks and CSV export | [API and webhooks](docs/api.md), [Accounts and CRM](docs/accounts-and-crm.md) |
| Add payments inside your Node.js project | The library: `import { BdConnector } from "@flowthera/bd-connector"` | [Node.js library](docs/node-library.md) |
| Let Claude or another AI agent take payments | The MCP connector | [Claude setup](docs/claude.md) |

**Website:** https://bd-connector-flowthera.new-website.workers.dev/products/bd-connector/
**Docs:** https://flowthera.github.io/bd-connector/

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

Read them on the [docs website](https://flowthera.github.io/bd-connector/), which also has the interactive [API reference](https://flowthera.github.io/bd-connector/api-reference.html) and a [button and link maker](https://flowthera.github.io/bd-connector/button-maker.html). Every server also shows its own API reference at `/docs`, where you can send test requests.

- [Setup guide](docs/setup-guide.md): from zero to your first test payment, then going live
- [Add to any website](docs/website-integration.md): payment links, the one-line Pay button, PHP and Python examples
- [Accounts and CRM](docs/accounts-and-crm.md): CSV export, Google Sheets, Zapier, Make and n8n
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
npm run docs:build   # builds the docs website into site/
```

Tests use a fake network, so they need no credentials. Contributions are welcome: open an issue or pull request.

## Hosted version

Don't want to run it yourself? Flowthera offers a hosted, supported version for businesses in Bangladesh at [bd.flowthera.com](https://bd.flowthera.com).

## License

[MIT](LICENSE) © Flowthera Infotech. Powered by [Flowthera](https://flowthera.com).
