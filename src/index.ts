#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createServer } from "./server.js";

const config = loadConfig();
const server = createServer(config);
await server.connect(new StdioServerTransport());
console.error(`Flowthera BD Connector running in ${config.mode} mode`);
