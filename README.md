# Flowthera BD Connector

Free, open-source [MCP](https://modelcontextprotocol.io) connector that lets Claude and other AI agents work with Bangladeshi payments and SMS.

> **Status: early development.** Sandbox mode is the default. Nothing here moves real money unless you explicitly switch to live mode with your own merchant credentials.

## Planned for v1

| Provider | Actions |
|---|---|
| bKash (Tokenized Checkout) | create payment, check status, refund |
| SSLCommerz | create payment session, validate / check status, refund |
| SMS gateway | send SMS, check balance |
| Nagad | planned for v1.1 |

## Quick start

```bash
git clone https://github.com/Flowthera/bd-connector
cd bd-connector
npm install
npm run build
```

Add it to Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bd-connector": {
      "command": "node",
      "args": ["/path/to/bd-connector/dist/index.js"],
      "env": { "BD_CONNECTOR_MODE": "sandbox" }
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add bd-connector -e BD_CONNECTOR_MODE=sandbox -- node /path/to/bd-connector/dist/index.js
```

See `.env.example` for every setting. Never commit real keys.

## Hosted version

Flowthera offers a hosted, supported version for businesses in Bangladesh. See [bd.flowthera.com](https://bd.flowthera.com).

## License

MIT © Flowthera Infotech. Powered by [Flowthera](https://flowthera.com).
