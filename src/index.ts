#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig, parseEnvFile } from "./config.js";
import { BdConnector } from "./connector.js";
import { createServer, VERSION } from "./server.js";
import { startServer } from "./web.js";

const HELP = `Flowthera BD Connector ${VERSION}

Usage:
  bd-connector            Run as an MCP server for Claude (stdio)
  bd-connector serve      Run the payment server: checkout page, gateway callbacks,
                          webhooks, SMS alerts, JSON API and dashboard
  bd-connector check      Show which gateways and features are set up
  bd-connector help       Show this help

Settings come from environment variables or a .env file in the current folder.
Docs: https://github.com/Flowthera/bd-connector/tree/main/docs`;

// A .env file in the current folder fills in anything not already set.
if (existsSync(".env")) {
  for (const [key, value] of Object.entries(parseEnvFile(readFileSync(".env", "utf8")))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const command = process.argv[2] ?? "mcp";
const config = loadConfig();

if (command === "help" || command === "--help" || command === "-h") {
  console.log(HELP);
} else if (command === "check") {
  const bd = new BdConnector({ config });
  const s = config.system;
  console.log(`Mode: ${config.mode}`);
  console.log(`Gateways set up: ${bd.providers().join(", ") || "none"}`);
  console.log(`SMS (BulkSMSBD): ${bd.sms ? "yes" : "no"}`);
  console.log(`Public URL: ${s.publicUrl ?? "not set (needed for payments)"}`);
  console.log(`Webhook: ${s.webhookUrl ?? "not set"}${s.webhookUrl && !s.webhookSecret ? " (warning: no BD_CONNECTOR_WEBHOOK_SECRET)" : ""}`);
  console.log(`API: ${s.apiKey ? "on" : "off"} · Dashboard: ${s.dashboardPassword ? "on" : "off"} · Checkout page: ${s.checkoutPage ? "on" : "off"}`);
  console.log(`Records: ${s.dataDir}`);
} else if (command === "serve") {
  const bd = new BdConnector({ config });
  const server = await startServer(bd);
  const s = config.system;
  const base = s.publicUrl ?? `http://localhost:${s.port}`;
  console.log(`Flowthera BD Connector ${VERSION} (${config.mode} mode) listening on port ${s.port}`);
  console.log(`Gateways: ${bd.providers().join(", ") || "none set up yet"}`);
  if (s.checkoutPage) console.log(`Checkout page: ${base}/pay`);
  console.log(s.dashboardPassword ? `Dashboard: ${base}/dashboard` : "Dashboard: off (set BD_CONNECTOR_DASHBOARD_PASSWORD)");
  if (!s.publicUrl) console.log("Note: set BD_CONNECTOR_PUBLIC_URL so gateways can send customers back.");
  const stop = async () => {
    server.close();
    await bd.flush();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} else if (command === "mcp") {
  const server = createServer(new BdConnector({ config }));
  await server.connect(new StdioServerTransport());
  console.error(`Flowthera BD Connector running in ${config.mode} mode`);
} else {
  console.error(`Unknown command "${command}".\n\n${HELP}`);
  process.exit(1);
}
