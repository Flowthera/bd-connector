import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../config.js";
import type { FetchFn } from "../http.js";
import { normalizeNumber } from "../providers/bulksmsbd.js";
import { createServer } from "../server.js";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** A fake fetch that records calls and answers from a route table keyed by URL substring. */
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  };
  return { fn, calls };
}

const ENV = {
  BKASH_APP_KEY: "key",
  BKASH_APP_SECRET: "secret",
  BKASH_USERNAME: "user",
  BKASH_PASSWORD: "pass",
  BKASH_CALLBACK_URL: "https://example.com/bkash",
  SSLCOMMERZ_STORE_ID: "store",
  SSLCOMMERZ_STORE_PASSWORD: "storepass",
  SSLCOMMERZ_SUCCESS_URL: "https://example.com/ok",
  BULKSMSBD_API_KEY: "smskey",
  BULKSMSBD_SENDER_ID: "8809600000000",
};

async function connect(env: Record<string, string>, routes: Record<string, unknown>) {
  const fake = fakeFetch(routes);
  const server = createServer(loadConfig(env), fake.fn);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    const text = result.content[0].text;
    return { isError: Boolean(result.isError), text, data: result.isError ? undefined : JSON.parse(text) };
  };
  return { client, call, calls: fake.calls };
}

test("defaults to sandbox and reports configured providers", async () => {
  const { call } = await connect({ BULKSMSBD_API_KEY: "k" }, {});
  const { data } = await call("connector_status");
  assert.equal(data.mode, "sandbox");
  assert.deepEqual(data.providers, { bkash: false, sslcommerz: false, sms: true });
});

test("lists every tool", async () => {
  const { client } = await connect({}, {});
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "bkash_create_payment",
    "bkash_execute_payment",
    "bkash_get_payment",
    "bkash_refund",
    "connector_status",
    "sms_balance",
    "sms_send",
    "sslcommerz_create_payment",
    "sslcommerz_get_payment",
    "sslcommerz_get_refund",
    "sslcommerz_refund",
  ]);
});

test("unconfigured provider returns a clear error", async () => {
  const { call } = await connect({}, {});
  const result = await call("bkash_get_payment", { payment_id: "x" });
  assert.equal(result.isError, true);
  assert.match(result.text, /BKASH_APP_KEY/);
});

test("bKash create payment uses the sandbox, grants a token once, and sends the right body", async () => {
  const { call, calls } = await connect(ENV, {
    "token/grant": { id_token: "tok", expires_in: 3600, statusCode: "0000" },
    "checkout/create": {
      statusCode: "0000",
      paymentID: "PAY1",
      bkashURL: "https://sandbox.payment.bkash.com/?paymentId=PAY1",
      transactionStatus: "Initiated",
      amount: "500.00",
      merchantInvoiceNumber: "INV-1",
    },
    "payment/status": { statusCode: "0000", paymentID: "PAY1", transactionStatus: "Initiated", amount: "500.00" },
  });
  const created = await call("bkash_create_payment", { amount: 500, invoice_number: "INV-1" });
  assert.equal(created.isError, false, created.text);
  assert.equal(created.data.paymentId, "PAY1");
  assert.match(created.data.paymentUrl, /PAY1/);
  await call("bkash_get_payment", { payment_id: "PAY1" });

  const grants = calls.filter((c) => c.url.includes("token/grant"));
  assert.equal(grants.length, 1, "token is reused");
  assert.ok(grants[0].url.startsWith("https://tokenized.sandbox.bka.sh/v1.2.0-beta/"));
  assert.equal(grants[0].headers.username, "user");
  assert.deepEqual(JSON.parse(grants[0].body), { app_key: "key", app_secret: "secret" });

  const create = calls.find((c) => c.url.includes("checkout/create"))!;
  assert.equal(create.headers.Authorization, "tok");
  assert.equal(create.headers["X-APP-Key"], "key");
  assert.deepEqual(JSON.parse(create.body), {
    mode: "0011",
    payerReference: "INV-1",
    callbackURL: "https://example.com/bkash",
    amount: "500.00",
    currency: "BDT",
    intent: "sale",
    merchantInvoiceNumber: "INV-1",
  });
});

test("live mode uses the live bKash host", async () => {
  const { call, calls } = await connect({ ...ENV, BD_CONNECTOR_MODE: "live" }, {
    "token/grant": { id_token: "tok", expires_in: 3600 },
    "payment/status": { statusCode: "0000", paymentID: "PAY1", transactionStatus: "Completed", trxID: "TRX1" },
  });
  const status = await call("bkash_get_payment", { payment_id: "PAY1" });
  assert.equal(status.data.mode, "live");
  assert.ok(calls.every((c) => c.url.startsWith("https://tokenized.pay.bka.sh/")));
});

test("bKash errors are surfaced with their code", async () => {
  const { call } = await connect(ENV, {
    "token/grant": { id_token: "tok", expires_in: 3600 },
    "checkout/execute": { statusCode: "2056", statusMessage: "Invalid Payment State" },
  });
  const result = await call("bkash_execute_payment", { payment_id: "PAY1" });
  assert.equal(result.isError, true);
  assert.match(result.text, /Invalid Payment State \(code 2056\)/);
});

test("bKash execute on an already-executed payment returns its status", async () => {
  const { call } = await connect(ENV, {
    "token/grant": { id_token: "tok", expires_in: 3600 },
    "checkout/execute": { statusCode: "2062", statusMessage: "The payment has already been completed" },
    "payment/status": { statusCode: "0000", paymentID: "PAY1", transactionStatus: "Completed", trxID: "TRX1" },
  });
  const result = await call("bkash_execute_payment", { payment_id: "PAY1" });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.data.status, "Completed");
  assert.equal(result.data.trxId, "TRX1");
});

test("bKash full refund reads the refundable amount first", async () => {
  const { call, calls } = await connect(ENV, {
    "token/grant": { id_token: "tok", expires_in: 3600 },
    "payment/status": { statusCode: "0000", maxRefundableAmount: "250.00" },
    "refund/payment/transaction": { refundTrxId: "R1", originalTrxId: "TRX1", refundTransactionStatus: "Completed", refundAmount: "250.00" },
  });
  const result = await call("bkash_refund", { payment_id: "PAY1", trx_id: "TRX1" });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.data.refundTrxId, "R1");
  const refund = calls.find((c) => c.url.includes("refund/payment/transaction"))!;
  assert.equal(refund.url, "https://tokenized.sandbox.bka.sh/v2/tokenized-checkout/refund/payment/transaction");
  assert.equal(JSON.parse(refund.body).refundAmount, "250.00");
});

test("SSLCommerz create payment posts a form to the sandbox", async () => {
  const { call, calls } = await connect(ENV, {
    "gwprocess/v4/api.php": { status: "SUCCESS", sessionkey: "S1", GatewayPageURL: "https://sandbox.sslcommerz.com/pay/S1" },
  });
  const result = await call("sslcommerz_create_payment", {
    amount: 100,
    tran_id: "T1",
    product_name: "Plan",
    customer_name: "Rahim",
    customer_phone: "01712345678",
  });
  assert.equal(result.isError, false, result.text);
  assert.equal(result.data.paymentUrl, "https://sandbox.sslcommerz.com/pay/S1");
  const form = new URLSearchParams(calls[0].body);
  assert.equal(calls[0].url, "https://sandbox.sslcommerz.com/gwprocess/v4/api.php");
  assert.equal(form.get("store_id"), "store");
  assert.equal(form.get("total_amount"), "100.00");
  assert.equal(form.get("fail_url"), "https://example.com/ok");
});

test("SSLCommerz failure reason is shown", async () => {
  const { call } = await connect(ENV, { "gwprocess/v4/api.php": { status: "FAILED", failedreason: "Store Credential Error Or Store is De-active" } });
  const result = await call("sslcommerz_create_payment", {
    amount: 100,
    tran_id: "T1",
    product_name: "Plan",
    customer_name: "Rahim",
    customer_phone: "01712345678",
  });
  assert.equal(result.isError, true);
  assert.match(result.text, /Store Credential Error/);
});

test("SSLCommerz payment lookup lists attempts", async () => {
  const { call, calls } = await connect(ENV, {
    merchantTransIDvalidationAPI: {
      APIConnect: "DONE",
      no_of_trans_found: 1,
      element: [{ status: "VALID", amount: "100.00", currency: "BDT", bank_tran_id: "B1", val_id: "V1", tran_date: "2026-10-09 12:00:00" }],
    },
  });
  const result = await call("sslcommerz_get_payment", { tran_id: "T1" });
  assert.equal(result.data.found, true);
  assert.equal(result.data.attempts[0].bankTranId, "B1");
  assert.match(calls[0].url, /tran_id=T1/);
  assert.match(calls[0].url, /format=json/);
});

test("SMS is a dry run in sandbox mode and makes no request", async () => {
  const { call, calls } = await connect(ENV, {});
  const result = await call("sms_send", { numbers: ["01712345678", "+880 1812-345678"], message: "Hello" });
  assert.equal(result.data.dryRun, true);
  assert.deepEqual(result.data.recipients, ["8801712345678", "8801812345678"]);
  assert.equal(calls.length, 0);
});

test("SMS sends in live mode and maps gateway errors", async () => {
  const ok = await connect({ ...ENV, BD_CONNECTOR_MODE: "live" }, { "/smsapi": { response_code: 202, success_message: "SMS Submitted Successfully" } });
  const sent = await ok.call("sms_send", { numbers: ["01712345678"], message: "Hi" });
  assert.equal(sent.data.sent, true);
  const form = new URLSearchParams(ok.calls[0].body);
  assert.equal(form.get("number"), "8801712345678");
  assert.equal(form.get("senderid"), "8809600000000");

  const low = await connect({ ...ENV, BD_CONNECTOR_MODE: "live" }, { "/smsapi": { response_code: 1007 } });
  const failed = await low.call("sms_send", { numbers: ["01712345678"], message: "Hi" });
  assert.equal(failed.isError, true);
  assert.match(failed.text, /insufficient balance \(code 1007\)/);
});

test("SMS balance", async () => {
  const { call } = await connect(ENV, { getBalanceApi: { response_code: 202, balance: 123.45 } });
  const result = await call("sms_balance");
  assert.equal(result.data.balance, 123.45);
});

test("number normalization", () => {
  assert.equal(normalizeNumber("01712345678"), "8801712345678");
  assert.equal(normalizeNumber("8801712345678"), "8801712345678");
  assert.equal(normalizeNumber("+88 017-1234-5678"), "8801712345678");
  assert.throws(() => normalizeNumber("0171234567"));
  assert.throws(() => normalizeNumber("01212345678"));
});
