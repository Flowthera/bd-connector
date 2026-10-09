#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const mode = process.env.BD_CONNECTOR_MODE === "live" ? "live" : "sandbox";

const server = new McpServer({ name: "flowthera-bd-connector", version: "0.1.0" });

server.registerTool(
  "connector_status",
  {
    title: "Connector status",
    description: "Shows the connector mode (sandbox or live) and which providers have credentials set.",
    inputSchema: {},
  },
  async () => {
    const configured = {
      bkash: Boolean(process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET),
      sslcommerz: Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASSWORD),
      sms: Boolean(process.env.SMS_API_KEY),
    };
    return { content: [{ type: "text", text: JSON.stringify({ mode, configured }, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
