import { VERSION } from "./version.js";
import { PROVIDERS } from "./types.js";

const statusEnum = ["pending", "success", "failed", "cancelled", "refunded"];

/** The JSON API described as OpenAPI 3.1, for Postman, code generators and the interactive docs. */
export function openApiSpec(serverUrl?: string) {
  const payment = { $ref: "#/components/schemas/Payment" };
  const error = { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
  const orderId = { name: "orderId", in: "path", required: true, schema: { type: "string" }, example: "BDMV17GQHEED9TGK" };
  return {
    openapi: "3.1.0",
    info: {
      title: "Flowthera BD Connector API",
      version: VERSION,
      description:
        "Take payments with bKash, Nagad, Rocket, Upay, cards and net banking from any website or app. " +
        "Start a payment, send the customer to `paymentUrl`, and get the result as a signed webhook. " +
        "Turn the API on by setting `BD_CONNECTOR_API_KEY`, then send `Authorization: Bearer <key>` from your server, never from a browser or app.",
      license: { name: "MIT", identifier: "MIT" },
      contact: { name: "Flowthera", url: "https://github.com/Flowthera/bd-connector" },
    },
    servers: [{ url: serverUrl ?? "{server}", ...(serverUrl ? {} : { variables: { server: { default: "http://localhost:8080", description: "Your BD_CONNECTOR_PUBLIC_URL" } } }) }],
    security: [{ apiKey: [] }],
    tags: [
      { name: "Payments", description: "Start, read, check and refund payments." },
      { name: "Reports", description: "Totals and exports for accounts and CRM." },
      { name: "Server", description: "Health and setup." },
    ],
    paths: {
      "/api/payments": {
        post: {
          tags: ["Payments"],
          operationId: "createPayment",
          summary: "Start a payment",
          description: "Creates a payment with the chosen gateway. Send the customer to `paymentUrl` in the reply. The result arrives as a webhook and on the payment record.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreatePayment" },
                example: {
                  provider: "bkash",
                  amount: 1250,
                  customer: { name: "Rahim Uddin", phone: "01712345678", email: "rahim@example.com" },
                  description: "2 books",
                  reference: "INV-1001",
                  metadata: { userId: "42" },
                },
              },
            },
          },
          responses: { "201": { description: "Payment started", content: { "application/json": { schema: payment } } }, "400": error, "401": error },
        },
        get: {
          tags: ["Payments"],
          operationId: "listPayments",
          summary: "List payments",
          description: "Newest first.",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: statusEnum } },
            { name: "provider", in: "query", schema: { type: "string", enum: PROVIDERS } },
            { name: "search", in: "query", description: "Order id, reference, name, phone, email or transaction ID", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100, minimum: 1 } },
          ],
          responses: { "200": { description: "Payments", content: { "application/json": { schema: { type: "array", items: payment } } } }, "401": error },
        },
      },
      "/api/payments/{orderId}": {
        get: {
          tags: ["Payments"],
          operationId: "getPayment",
          summary: "Get one payment",
          parameters: [orderId],
          responses: { "200": { description: "The payment", content: { "application/json": { schema: payment } } }, "404": error, "401": error },
        },
      },
      "/api/payments/{orderId}/verify": {
        post: {
          tags: ["Payments"],
          operationId: "verifyPayment",
          summary: "Check with the gateway",
          description: "Asks the gateway for the latest result and updates the record. Sends the webhook and SMS if the status changes.",
          parameters: [orderId],
          responses: { "200": { description: "The updated payment", content: { "application/json": { schema: payment } } }, "404": error, "401": error },
        },
      },
      "/api/payments/{orderId}/refund": {
        post: {
          tags: ["Payments"],
          operationId: "refundPayment",
          summary: "Refund a payment",
          description: "bKash and SSLCommerz only. Leave out `amount` to refund everything that's left. **Moves real money in live mode.**",
          parameters: [orderId],
          requestBody: {
            content: {
              "application/json": {
                schema: { type: "object", properties: { amount: { type: "number", exclusiveMinimum: 0 }, reason: { type: "string", maxLength: 255 } } },
                example: { amount: 500, reason: "Item out of stock" },
              },
            },
          },
          responses: { "200": { description: "The updated payment", content: { "application/json": { schema: payment } } }, "400": error, "401": error },
        },
      },
      "/api/payments.csv": {
        get: {
          tags: ["Reports"],
          operationId: "exportPayments",
          summary: "Export payments as CSV",
          description: "Opens in Excel, Google Sheets or accounting software. Takes the same filters as listing payments.",
          parameters: [
            { name: "status", in: "query", schema: { type: "string", enum: statusEnum } },
            { name: "provider", in: "query", schema: { type: "string", enum: PROVIDERS } },
            { name: "from", in: "query", description: "Created on or after this date (YYYY-MM-DD, Dhaka time)", schema: { type: "string", format: "date" } },
            { name: "to", in: "query", description: "Created on or before this date (YYYY-MM-DD, Dhaka time)", schema: { type: "string", format: "date" } },
          ],
          responses: { "200": { description: "CSV file", content: { "text/csv": { schema: { type: "string" } } } }, "401": error },
        },
      },
      "/api/summary": {
        get: {
          tags: ["Reports"],
          operationId: "getSummary",
          summary: "Totals",
          responses: { "200": { description: "Totals", content: { "application/json": { schema: { $ref: "#/components/schemas/Summary" } } } }, "401": error },
        },
      },
      "/api/providers": {
        get: {
          tags: ["Server"],
          operationId: "getProviders",
          summary: "Mode and gateways",
          responses: {
            "200": {
              description: "Mode and the gateways that are set up",
              content: { "application/json": { schema: { type: "object", properties: { mode: { type: "string", enum: ["sandbox", "live"] }, providers: { type: "array", items: { type: "string", enum: PROVIDERS } } } } } },
            },
          },
        },
      },
      "/health": {
        get: {
          tags: ["Server"],
          operationId: "health",
          summary: "Health check",
          security: [],
          responses: { "200": { description: "The server is up", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, mode: { type: "string" }, providers: { type: "array", items: { type: "string" } } } } } } } },
        },
      },
    },
    webhooks: {
      paymentResult: {
        post: {
          summary: "Payment result",
          description:
            "Sent to `BD_CONNECTOR_WEBHOOK_URL` on `payment.success`, `payment.failed`, `payment.cancelled` and `payment.refunded`. " +
            "Check `X-BD-Signature` (`sha256=` + HMAC-SHA256 of the raw body with `BD_CONNECTOR_WEBHOOK_SECRET`) before trusting it, and answer with any 2xx status.",
          parameters: [
            { name: "X-BD-Event", in: "header", schema: { type: "string", enum: ["payment.success", "payment.failed", "payment.cancelled", "payment.refunded"] } },
            { name: "X-BD-Signature", in: "header", schema: { type: "string" }, example: "sha256=5d1c…" },
          ],
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/WebhookEvent" } } } },
          responses: { "200": { description: "Received" } },
        },
      },
    },
    components: {
      securitySchemes: { apiKey: { type: "http", scheme: "bearer", description: "The value of BD_CONNECTOR_API_KEY" } },
      schemas: {
        CreatePayment: {
          type: "object",
          required: ["provider", "amount", "customer"],
          properties: {
            provider: { type: "string", enum: PROVIDERS, description: "bkash, nagad, sslcommerz (cards, wallets, net banking), shurjopay or aamarpay (Rocket, Upay, wallets, cards)" },
            amount: { type: "number", exclusiveMinimum: 0, description: "Taka, up to 2 decimals. SSLCommerz minimum is 10." },
            customer: { $ref: "#/components/schemas/Customer" },
            description: { type: "string", description: "What the payment is for" },
            reference: { type: "string", description: "Your own order or invoice number" },
            metadata: { type: "object", additionalProperties: { type: "string" }, description: "Your own key-value pairs, returned in webhooks" },
          },
        },
        Customer: {
          type: "object",
          required: ["name", "phone"],
          properties: {
            name: { type: "string" },
            phone: { type: "string", description: "Bangladeshi mobile number in any common format; stored as 01XXXXXXXXX" },
            email: { type: "string", format: "email" },
            address: { type: "string" },
            city: { type: "string" },
          },
        },
        Payment: {
          type: "object",
          properties: {
            orderId: { type: "string", description: "The connector's id: 16 letters and digits" },
            reference: { type: ["string", "null"], description: "Your order or invoice number" },
            provider: { type: "string", enum: PROVIDERS },
            mode: { type: "string", enum: ["sandbox", "live"] },
            status: { type: "string", enum: statusEnum },
            paid: { type: "boolean", description: "true only when status is success" },
            amount: { type: "number" },
            paidAmount: { type: ["number", "null"] },
            currency: { type: "string", const: "BDT" },
            description: { type: "string" },
            customer: { $ref: "#/components/schemas/Customer" },
            transactionId: { type: ["string", "null"], description: "The transaction ID the customer sees" },
            gatewayReference: { type: ["string", "null"] },
            gateway: { type: "object", additionalProperties: { type: "string" } },
            method: { type: ["string", "null"], description: "How the customer paid, when the gateway says" },
            message: { type: ["string", "null"] },
            metadata: { type: "object", additionalProperties: { type: "string" } },
            paymentUrl: { type: ["string", "null"], format: "uri" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
            paidAt: { type: ["string", "null"], format: "date-time" },
            refunds: { type: "array", items: { type: "object", properties: { amount: { type: "number" }, status: { type: "string" }, reference: { type: ["string", "null"] }, createdAt: { type: "string", format: "date-time" } } } },
            notifications: {
              type: "array",
              items: {
                type: "object",
                properties: { kind: { type: "string", enum: ["webhook", "sms"] }, to: { type: "string" }, event: { type: "string" }, ok: { type: "boolean" }, dryRun: { type: "boolean" }, error: { type: "string" }, at: { type: "string", format: "date-time" } },
              },
            },
          },
        },
        Summary: {
          type: "object",
          properties: {
            count: { type: "integer" },
            byStatus: { type: "object", additionalProperties: { type: "object", properties: { count: { type: "integer" }, amount: { type: "number" } } } },
            receivedToday: { type: "number", description: "Today in Dhaka" },
            receivedTotal: { type: "number" },
          },
        },
        WebhookEvent: {
          type: "object",
          properties: {
            event: { type: "string", enum: ["payment.success", "payment.failed", "payment.cancelled", "payment.refunded"] },
            sentAt: { type: "string", format: "date-time" },
            payment: { $ref: "#/components/schemas/Payment" },
          },
        },
        Error: { type: "object", properties: { error: { type: "string" }, code: { type: "string" } } },
      },
    },
  };
}
