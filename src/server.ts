import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { BdConnector } from "./connector.js";
import { ProviderError, type FetchFn } from "./http.js";
import { MemoryStore } from "./store.js";
import { PROVIDERS } from "./types.js";
import { summarize } from "./web.js";

export const VERSION = "0.3.0";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(task: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const result = await task();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  } catch (error) {
    const message = error instanceof ProviderError || error instanceof Error ? error.message : String(error);
    return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
  }
}

function notConfigured(provider: string, vars: string): never {
  throw new ProviderError(provider, `not configured. Set ${vars} in the connector's environment.`, "not_configured");
}

const MONEY_NOTE = " In live mode this moves real money.";

export function createServer(source: BdConnector | Config, fetchFn: FetchFn = fetch): McpServer {
  const bd = source instanceof BdConnector ? source : new BdConnector({ config: source, fetch: fetchFn, store: new MemoryStore() });
  const config = bd.config;
  const server = new McpServer({ name: "flowthera-bd-connector", version: VERSION });
  const { mode } = config;
  const { bkash, sslcommerz: ssl, sms } = bd;

  const needBkash = () => bkash || notConfigured("bKash", "BKASH_APP_KEY, BKASH_APP_SECRET, BKASH_USERNAME and BKASH_PASSWORD");
  const needSsl = () => ssl || notConfigured("SSLCommerz", "SSLCOMMERZ_STORE_ID and SSLCOMMERZ_STORE_PASSWORD");
  const needNagad = () => bd.nagad || notConfigured("Nagad", "NAGAD_MERCHANT_ID, NAGAD_MERCHANT_NUMBER, NAGAD_MERCHANT_PRIVATE_KEY and NAGAD_PUBLIC_KEY");
  const needSms = () => sms || notConfigured("SMS", "BULKSMSBD_API_KEY (and BULKSMSBD_SENDER_ID to send)");

  server.registerTool(
    "connector_status",
    {
      title: "Connector status",
      description: "Shows whether the connector is in sandbox or live mode and which providers are configured.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () =>
      run(async () => ({
        version: VERSION,
        mode,
        providers: {
          bkash: Boolean(bkash),
          nagad: Boolean(config.nagad),
          sslcommerz: Boolean(ssl),
          shurjopay: Boolean(bd.shurjopay),
          aamarpay: Boolean(bd.aamarpay),
          sms: Boolean(sms),
        },
        paymentSystem: {
          publicUrl: config.system.publicUrl ?? null,
          webhook: Boolean(config.system.webhookUrl),
          smsToCustomer: Boolean(sms) && config.system.smsNotifyCustomer,
          smsToOwner: config.system.smsOwnerNumbers.length,
        },
        note: mode === "sandbox" ? "Sandbox mode: payments use test gateways and SMS are not sent." : "Live mode: real money and real SMS.",
      })),
  );

  // One flow for every gateway
  server.registerTool(
    "payment_create",
    {
      title: "Create a payment (any gateway)",
      description:
        "Starts a payment with any set-up gateway and returns a paymentUrl for the customer. The connector's server confirms the result when the customer returns, then sends the webhook and SMS. Needs BD_CONNECTOR_PUBLIC_URL pointing at a running `bd-connector serve`.",
      inputSchema: {
        provider: z.enum(PROVIDERS).describe("bkash, nagad, sslcommerz (cards and wallets), shurjopay or aamarpay (Rocket, Upay and more)"),
        amount: z.number().positive().describe("Amount in BDT"),
        customer_name: z.string().min(1),
        customer_phone: z.string().min(1).describe("Bangladeshi mobile number; gets the receipt SMS"),
        customer_email: z.string().email().optional(),
        description: z.string().max(200).optional().describe("What the payment is for"),
        reference: z.string().max(100).optional().describe("Your own order or invoice number"),
      },
    },
    (args) =>
      run(() =>
        bd.createPayment({
          provider: args.provider,
          amount: args.amount,
          customer: { name: args.customer_name, phone: args.customer_phone, email: args.customer_email },
          description: args.description,
          reference: args.reference,
        }),
      ),
  );

  server.registerTool(
    "payment_check",
    {
      title: "Check a payment",
      description: "Asks the gateway for the latest result of a payment made with payment_create and returns the full record (status, amount, customer, transaction ID).",
      inputSchema: { order_id: z.string().min(1) },
    },
    (args) => run(() => bd.verifyPayment(args.order_id)),
  );

  server.registerTool(
    "payments_list",
    {
      title: "List payments",
      description: "Lists recorded payments, newest first, with totals. Filter by status or search by order, name, phone or transaction ID.",
      inputSchema: {
        status: z.enum(["pending", "success", "failed", "cancelled", "refunded"]).optional(),
        search: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (args) =>
      run(async () => {
        const payments = await bd.listPayments({ status: args.status, search: args.search, limit: args.limit ?? 50 });
        return { summary: summarize(await bd.listPayments({ limit: 1_000_000 })), payments };
      }),
  );

  server.registerTool(
    "payment_refund",
    {
      title: "Refund a payment",
      description: "Refunds a successful bKash or SSLCommerz payment by order id. Leave amount empty for the full amount." + MONEY_NOTE,
      inputSchema: {
        order_id: z.string().min(1),
        amount: z.number().positive().optional(),
        reason: z.string().max(255).optional(),
      },
      annotations: { destructiveHint: true },
    },
    (args) => run(() => bd.refundPayment(args.order_id, args.amount, args.reason)),
  );

  // bKash
  server.registerTool(
    "bkash_create_payment",
    {
      title: "bKash: create payment",
      description: "Starts a bKash payment and returns a link where the customer approves it. After approval, call bkash_execute_payment.",
      inputSchema: {
        amount: z.number().positive().describe("Amount in BDT, e.g. 500 or 99.50"),
        invoice_number: z.string().min(1).max(255).describe("Your unique order or invoice number"),
        payer_reference: z.string().max(255).optional().describe("Optional customer reference, such as a phone number"),
        callback_url: z.string().url().optional().describe("Where bKash sends the customer afterwards. Defaults to BKASH_CALLBACK_URL"),
      },
    },
    (args) =>
      run(() =>
        needBkash().createPayment({
          amount: args.amount,
          invoiceNumber: args.invoice_number,
          payerReference: args.payer_reference,
          callbackUrl: args.callback_url,
        }),
      ),
  );

  server.registerTool(
    "bkash_execute_payment",
    {
      title: "bKash: complete payment",
      description: "Completes a bKash payment the customer has approved. Call once per payment." + MONEY_NOTE,
      inputSchema: { payment_id: z.string().min(1).describe("paymentId from bkash_create_payment") },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    (args) => run(() => needBkash().executePayment(args.payment_id)),
  );

  server.registerTool(
    "bkash_get_payment",
    {
      title: "bKash: payment status",
      description: "Looks up the current status of a bKash payment.",
      inputSchema: { payment_id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needBkash().getPayment(args.payment_id)),
  );

  server.registerTool(
    "bkash_refund",
    {
      title: "bKash: refund",
      description: "Refunds all or part of a completed bKash payment. Leave amount empty for a full refund." + MONEY_NOTE,
      inputSchema: {
        payment_id: z.string().min(1),
        trx_id: z.string().min(1).describe("trxId of the completed payment"),
        amount: z.number().positive().optional().describe("Amount in BDT. Omit for the full refundable amount"),
        reason: z.string().max(255).optional(),
      },
      annotations: { destructiveHint: true },
    },
    (args) =>
      run(() =>
        needBkash().refund({ paymentId: args.payment_id, trxId: args.trx_id, amount: args.amount, reason: args.reason }),
      ),
  );

  // Nagad
  server.registerTool(
    "nagad_create_payment",
    {
      title: "Nagad: create payment",
      description: "Starts a Nagad payment and returns the link where the customer pays. Confirm afterwards with nagad_get_payment.",
      inputSchema: {
        amount: z.number().positive().describe("Amount in BDT"),
        order_id: z.string().regex(/^[A-Za-z0-9]{1,20}$/).describe("Your unique order id: 1-20 letters or digits"),
        callback_url: z.string().url().optional().describe("Where Nagad sends the customer afterwards. Defaults to NAGAD_CALLBACK_URL"),
      },
    },
    (args) => run(() => needNagad().createPayment({ amount: args.amount, orderId: args.order_id, callbackUrl: args.callback_url })),
  );

  server.registerTool(
    "nagad_get_payment",
    {
      title: "Nagad: payment status",
      description: "Asks Nagad whether a payment succeeded. This is the reliable check; don't trust the customer's redirect alone.",
      inputSchema: { payment_ref_id: z.string().min(1).describe("paymentRefId from nagad_create_payment") },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needNagad().getPayment(args.payment_ref_id)),
  );

  // SSLCommerz
  server.registerTool(
    "sslcommerz_create_payment",
    {
      title: "SSLCommerz: create payment",
      description: "Opens an SSLCommerz checkout (cards, mobile banking, net banking) and returns the payment link for the customer.",
      inputSchema: {
        amount: z.number().min(10).describe("Amount in BDT (SSLCommerz minimum is 10)"),
        tran_id: z.string().min(1).max(30).describe("Your unique transaction or order id"),
        product_name: z.string().min(1),
        customer_name: z.string().min(1),
        customer_phone: z.string().min(1),
        customer_email: z.string().email().optional(),
        customer_address: z.string().optional(),
        customer_city: z.string().optional(),
        success_url: z.string().url().optional().describe("Defaults to SSLCOMMERZ_SUCCESS_URL"),
        fail_url: z.string().url().optional(),
        cancel_url: z.string().url().optional(),
      },
    },
    (args) =>
      run(() =>
        needSsl().createSession({
          amount: args.amount,
          tranId: args.tran_id,
          productName: args.product_name,
          customerName: args.customer_name,
          customerPhone: args.customer_phone,
          customerEmail: args.customer_email,
          customerAddress: args.customer_address,
          customerCity: args.customer_city,
          successUrl: args.success_url,
          failUrl: args.fail_url,
          cancelUrl: args.cancel_url,
        }),
      ),
  );

  server.registerTool(
    "sslcommerz_get_payment",
    {
      title: "SSLCommerz: payment status",
      description: "Looks up an SSLCommerz payment by your transaction id and lists every attempt with its status.",
      inputSchema: { tran_id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needSsl().getPayment(args.tran_id)),
  );

  server.registerTool(
    "sslcommerz_refund",
    {
      title: "SSLCommerz: refund",
      description: "Requests a refund for an SSLCommerz payment." + MONEY_NOTE,
      inputSchema: {
        bank_tran_id: z.string().min(1).describe("bankTranId from sslcommerz_get_payment"),
        amount: z.number().positive(),
        remarks: z.string().min(1).max(255),
        reference_id: z.string().optional().describe("Your own reference for this refund"),
      },
      annotations: { destructiveHint: true },
    },
    (args) =>
      run(() =>
        needSsl().refund({ bankTranId: args.bank_tran_id, amount: args.amount, remarks: args.remarks, referenceId: args.reference_id }),
      ),
  );

  server.registerTool(
    "sslcommerz_get_refund",
    {
      title: "SSLCommerz: refund status",
      description: "Checks the status of an SSLCommerz refund.",
      inputSchema: { refund_ref_id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needSsl().getRefund(args.refund_ref_id)),
  );

  // shurjoPay and aamarPay: one checkout for Rocket, Upay, bKash, Nagad and cards
  const needShurjopay = () => bd.shurjopay || notConfigured("shurjoPay", "SHURJOPAY_USERNAME and SHURJOPAY_PASSWORD");
  const needAamarpay = () => bd.aamarpay || notConfigured("aamarPay", "AAMARPAY_STORE_ID and AAMARPAY_SIGNATURE_KEY");

  server.registerTool(
    "shurjopay_create_payment",
    {
      title: "shurjoPay: create payment",
      description: "Opens a shurjoPay checkout (Rocket, Upay, bKash, Nagad, cards) and returns the payment link. Confirm afterwards with shurjopay_get_payment.",
      inputSchema: {
        amount: z.number().positive(),
        order_id: z.string().min(1).max(50),
        customer_name: z.string().min(1),
        customer_phone: z.string().min(1),
        customer_address: z.string().optional(),
        customer_city: z.string().optional(),
        return_url: z.string().url().optional().describe("Defaults to SHURJOPAY_RETURN_URL"),
      },
    },
    (args) =>
      run(() =>
        needShurjopay().createPayment({
          amount: args.amount,
          orderId: args.order_id,
          customerName: args.customer_name,
          customerPhone: args.customer_phone,
          customerAddress: args.customer_address,
          customerCity: args.customer_city,
          returnUrl: args.return_url,
        }),
      ),
  );

  server.registerTool(
    "shurjopay_get_payment",
    {
      title: "shurjoPay: payment status",
      description: "Asks shurjoPay whether a payment succeeded.",
      inputSchema: { sp_order_id: z.string().min(1).describe("spOrderId from shurjopay_create_payment") },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needShurjopay().getPayment(args.sp_order_id)),
  );

  server.registerTool(
    "aamarpay_create_payment",
    {
      title: "aamarPay: create payment",
      description: "Opens an aamarPay checkout (Rocket, Upay, bKash, Nagad, cards) and returns the payment link. Confirm afterwards with aamarpay_get_payment.",
      inputSchema: {
        amount: z.number().positive(),
        order_id: z.string().min(1).max(50),
        description: z.string().min(1).max(200),
        customer_name: z.string().min(1),
        customer_phone: z.string().min(1),
        customer_email: z.string().email().optional(),
        success_url: z.string().url().optional().describe("Defaults to AAMARPAY_SUCCESS_URL"),
      },
    },
    (args) =>
      run(() =>
        needAamarpay().createPayment({
          amount: args.amount,
          orderId: args.order_id,
          description: args.description,
          customerName: args.customer_name,
          customerPhone: args.customer_phone,
          customerEmail: args.customer_email,
          successUrl: args.success_url,
        }),
      ),
  );

  server.registerTool(
    "aamarpay_get_payment",
    {
      title: "aamarPay: payment status",
      description: "Asks aamarPay whether a payment succeeded, by your order id.",
      inputSchema: { order_id: z.string().min(1) },
      annotations: { readOnlyHint: true },
    },
    (args) => run(() => needAamarpay().getPayment(args.order_id)),
  );

  // SMS
  server.registerTool(
    "sms_send",
    {
      title: "SMS: send",
      description:
        "Sends an SMS to one or more Bangladeshi mobile numbers through BulkSMSBD. In sandbox mode nothing is sent. In live mode this uses SMS balance.",
      inputSchema: {
        numbers: z.array(z.string().min(1)).min(1).max(100).describe("Numbers like 01712345678 or +8801712345678"),
        message: z.string().min(1).max(1000),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    (args) => run(() => needSms().send(args.numbers, args.message)),
  );

  server.registerTool(
    "sms_balance",
    {
      title: "SMS: balance",
      description: "Shows the remaining BulkSMSBD balance in BDT.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => run(() => needSms().balance()),
  );

  return server;
}
