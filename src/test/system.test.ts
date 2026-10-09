import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig, parseEnvFile } from "../config.js";
import { BdConnector, newOrderId, verifyWebhookSignature } from "../connector.js";
import type { FetchFn } from "../http.js";
import { FileStore, MemoryStore } from "../store.js";
import type { Payment } from "../types.js";
import { signReturn, startServer, summarize } from "../web.js";

type Route = unknown | ((url: string, body: string) => unknown);

function fakeFetch(routes: Record<string, Route>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string }[] = [];
  const fn: FetchFn = async (input, init) => {
    const url = String(input);
    const body = String(init?.body ?? "");
    calls.push({ url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response("not found", { status: 404 });
    const route = routes[key];
    const value = typeof route === "function" ? (route as (u: string, b: string) => unknown)(url, body) : route;
    return new Response(JSON.stringify(value), { status: 200 });
  };
  return { fn, calls };
}

const BASE_ENV = {
  BD_CONNECTOR_PUBLIC_URL: "https://pay.example.com/",
  BD_CONNECTOR_BUSINESS_NAME: "Test Shop",
  BD_CONNECTOR_WEBHOOK_URL: "https://shop.example.com/hooks/payments",
  BD_CONNECTOR_WEBHOOK_SECRET: "whsec",
  BULKSMSBD_API_KEY: "smskey",
  BULKSMSBD_SENDER_ID: "8809600000000",
  SMS_OWNER_NUMBERS: "01811111111",
  BKASH_APP_KEY: "key",
  BKASH_APP_SECRET: "secret",
  BKASH_USERNAME: "user",
  BKASH_PASSWORD: "pass",
  SSLCOMMERZ_STORE_ID: "store",
  SSLCOMMERZ_STORE_PASSWORD: "storepass",
  SHURJOPAY_USERNAME: "sp_sandbox",
  SHURJOPAY_PASSWORD: "sppass",
  SHURJOPAY_PREFIX: "SP",
  AAMARPAY_STORE_ID: "aamarpaytest",
  AAMARPAY_SIGNATURE_KEY: "sig",
};

const BKASH_ROUTES = {
  "token/grant": { id_token: "tok", expires_in: 3600, statusCode: "0000" },
  "checkout/create": (_u: string, body: string) => ({
    statusCode: "0000",
    paymentID: "PAY1",
    bkashURL: "https://sandbox.bka.sh/pay/PAY1",
    transactionStatus: "Initiated",
    amount: JSON.parse(body).amount,
    merchantInvoiceNumber: JSON.parse(body).merchantInvoiceNumber,
  }),
  "checkout/execute": { statusCode: "0000", paymentID: "PAY1", trxID: "TRX9", transactionStatus: "Completed", amount: "500.00", customerMsisdn: "01770618575" },
  "refund/payment/transaction": { statusCode: "0000", refundTrxId: "RF1", refundTransactionStatus: "Completed", refundAmount: "500.00" },
  "shop.example.com/hooks": { ok: true },
};

function make(routes: Record<string, Route>, env: Record<string, string> = {}) {
  const fake = fakeFetch(routes);
  const bd = new BdConnector({ config: loadConfig({ ...BASE_ENV, ...env }), fetch: fake.fn, store: new MemoryStore(), webhookRetryDelaysMs: [0, 0] });
  return { bd, calls: fake.calls };
}

const CUSTOMER = { name: "Rahim", phone: "+880 1712-345678", email: "rahim@example.com" };

test("order ids are short and accepted by every gateway", () => {
  const ids = new Set(Array.from({ length: 200 }, newOrderId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9]{1,20}$/);
});

test("full bKash cycle: create, callback, success record, signed webhook, SMS and event", async () => {
  const { bd, calls } = make(BKASH_ROUTES);
  const events: string[] = [];
  bd.on("payment.success", (p) => void events.push(`success:${p.orderId}`));
  bd.on("payment.*", (_p, e) => void events.push(`any:${e}`));

  const created = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER, reference: "INV-1001", metadata: { plan: "gold" } });
  assert.equal(created.status, "pending");
  assert.equal(created.paymentUrl, "https://sandbox.bka.sh/pay/PAY1");
  assert.equal(created.customer.phone, "01712345678");
  const createBody = JSON.parse(calls.find((c) => c.url.includes("checkout/create"))!.body);
  assert.equal(createBody.callbackURL, `https://pay.example.com/callback/bkash/${created.orderId}`);
  assert.equal(createBody.merchantInvoiceNumber, created.orderId);

  const done = await bd.handleCallback("bkash", created.orderId, { paymentID: "PAY1", status: "success" });
  assert.equal(done.status, "success");
  assert.equal(done.paid, true);
  assert.equal(done.transactionId, "TRX9");
  assert.equal(done.paidAmount, 500);
  assert.equal(done.reference, "INV-1001");
  assert.ok(done.paidAt);
  await bd.flush();

  const hook = calls.find((c) => c.url.includes("shop.example.com/hooks"))!;
  assert.equal(hook.headers["X-BD-Event"], "payment.success");
  assert.ok(verifyWebhookSignature(hook.body, hook.headers["X-BD-Signature"], "whsec"));
  assert.equal(verifyWebhookSignature(hook.body, hook.headers["X-BD-Signature"], "wrong"), false);
  const payload = JSON.parse(hook.body);
  assert.equal(payload.event, "payment.success");
  assert.equal(payload.payment.amount, 500);
  assert.equal(payload.payment.customer.name, "Rahim");
  assert.deepEqual(payload.payment.metadata, { plan: "gold" });

  const stored = (await bd.getPayment(created.orderId))!;
  const sms = stored.notifications.filter((n) => n.kind === "sms");
  assert.deepEqual(sms.map((n) => n.to).sort(), ["01712345678", "01811111111"]);
  assert.ok(sms.every((n) => n.ok && n.dryRun), "sandbox SMS is a dry run");
  assert.ok(stored.notifications.some((n) => n.kind === "webhook" && n.ok));
  assert.deepEqual(events, [`success:${created.orderId}`, "any:payment.success"]);
  assert.equal(calls.filter((c) => c.url.includes("bulksmsbd")).length, 0);

  // A repeated callback changes nothing and sends nothing again.
  const again = await bd.handleCallback("bkash", created.orderId, { paymentID: "PAY1", status: "success" });
  await bd.flush();
  assert.equal(again.status, "success");
  assert.equal(calls.filter((c) => c.url.includes("checkout/execute")).length, 1);
  assert.equal(calls.filter((c) => c.url.includes("shop.example.com")).length, 1);
});

test("live SMS goes out through BulkSMSBD with the filled template", async () => {
  const { bd, calls } = make({ ...BKASH_ROUTES, "bulksmsbd.net/api/smsapi": { response_code: 202, success_message: "ok" } }, { BD_CONNECTOR_MODE: "live" });
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  await bd.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "success" });
  await bd.flush();
  const texts = calls.filter((c) => c.url.includes("smsapi")).map((c) => new URLSearchParams(c.body));
  const toCustomer = texts.find((t) => t.get("number") === "8801712345678")!;
  assert.equal(toCustomer.get("message"), `Test Shop: payment of Tk 500 received for order ${p.orderId}. Trx ID TRX9. Thank you!`);
  assert.match(texts.find((t) => t.get("number") === "8801811111111")!.get("message")!, /Paid: Tk 500 by Rahim 01712345678 via bkash/);
});

test("bKash cancel marks the payment cancelled and only tells the owner", async () => {
  const { bd, calls } = make(BKASH_ROUTES);
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  const done = await bd.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "cancel" });
  await bd.flush();
  assert.equal(done.status, "cancelled");
  assert.equal(done.paid, false);
  assert.equal(calls.filter((c) => c.url.includes("execute")).length, 0);
  const stored = (await bd.getPayment(p.orderId))!;
  assert.deepEqual(stored.notifications.filter((n) => n.kind === "sms").map((n) => n.to), ["01811111111"]);
  assert.equal(JSON.parse(calls.find((c) => c.url.includes("shop.example.com"))!.body).event, "payment.cancelled");
});

test("a callback with another payment's id is refused", async () => {
  const { bd } = make(BKASH_ROUTES);
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  await assert.rejects(bd.handleCallback("bkash", p.orderId, { paymentID: "OTHER", status: "success" }), /does not match/);
  await assert.rejects(bd.handleCallback("nagad", p.orderId, {}), /was not paid with nagad/);
});

test("a paid amount different from the order is not marked as paid", async () => {
  const { bd } = make({ ...BKASH_ROUTES, "checkout/execute": { statusCode: "0000", paymentID: "PAY1", trxID: "T", transactionStatus: "Completed", amount: "5.00" } });
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  const done = await bd.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "success" });
  assert.equal(done.status, "failed");
  assert.match(done.message!, /Amount mismatch/);
});

test("bKash refund through the connector", async () => {
  const { bd, calls } = make(BKASH_ROUTES);
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  await bd.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "success" });
  const refunded = await bd.refundPayment(p.orderId);
  assert.equal(refunded.status, "refunded");
  assert.equal(refunded.refunds[0].reference, "RF1");
  const body = JSON.parse(calls.find((c) => c.url.includes("refund/payment"))!.body);
  assert.equal(body.trxId, "TRX9");
  assert.equal(body.refundAmount, "500.00");
  await assert.rejects(bd.refundPayment(p.orderId), /only successful payments/);
});

test("validation errors are clear", async () => {
  const { bd } = make(BKASH_ROUTES);
  await assert.rejects(bd.createPayment({ provider: "bkash", amount: 0, customer: CUSTOMER }), /positive/);
  await assert.rejects(bd.createPayment({ provider: "bkash", amount: 10, customer: { name: "A", phone: "123" } }), /not a valid Bangladeshi mobile number/);
  await assert.rejects(bd.createPayment({ provider: "nagad", amount: 10, customer: CUSTOMER }), /nagad is not set up/);
  await assert.rejects(bd.createPayment({ provider: "paypal" as any, amount: 10, customer: CUSTOMER }), /unknown provider/);
  const noUrl = new BdConnector({ config: loadConfig({ ...BASE_ENV, BD_CONNECTOR_PUBLIC_URL: "" }), fetch: fakeFetch(BKASH_ROUTES).fn, store: new MemoryStore() });
  await assert.rejects(noUrl.createPayment({ provider: "bkash", amount: 10, customer: CUSTOMER }), /BD_CONNECTOR_PUBLIC_URL/);
});

test("shurjoPay: token, checkout with the right fields, and verification", async () => {
  const { bd, calls } = make({
    "sandbox.shurjopayment.com/api/get_token": { token: "sptok", token_type: "Bearer", store_id: 1, execute_url: "https://sandbox.shurjopayment.com/api/secret-pay", expires_in: 3600 },
    "api/secret-pay": { checkout_url: "https://sandbox.shurjopayment.com/spaycheckout/?token=x", sp_order_id: "SP123" },
    "api/verification": [{ sp_code: "1000", sp_message: "Success", amount: "250.00", bank_trx_id: "BT77", method: "Rocket", customer_order_id: "x", date_time: "2026-10-09 12:00:00" }],
    "shop.example.com": {},
  });
  const p = await bd.createPayment({ provider: "shurjopay", amount: 250, customer: CUSTOMER, description: "Course fee" });
  assert.equal(p.paymentUrl, "https://sandbox.shurjopayment.com/spaycheckout/?token=x");
  assert.equal(p.gatewayReference, "SP123");
  const body = JSON.parse(calls.find((c) => c.url.includes("secret-pay"))!.body);
  assert.equal(body.token, "sptok");
  assert.equal(body.prefix, "SP");
  assert.equal(body.order_id, p.orderId);
  assert.equal(body.return_url, `https://pay.example.com/callback/shurjopay/${p.orderId}`);
  const done = await bd.handleCallback("shurjopay", p.orderId, { order_id: "SP123" });
  assert.equal(done.status, "success");
  assert.equal(done.transactionId, "BT77");
  assert.equal(done.method, "Rocket");
  const verify = calls.find((c) => c.url.includes("verification"))!;
  assert.equal(verify.headers.Authorization, "Bearer sptok");
  assert.deepEqual(JSON.parse(verify.body), { order_id: "SP123" });
  assert.equal(calls.filter((c) => c.url.includes("get_token")).length, 1, "token is reused");
});

test("shurjoPay cancelled and declined codes", async () => {
  for (const [code, status] of [["1002", "cancelled"], ["1001", "failed"]]) {
    const { bd } = make({
      get_token: { token: "t", token_type: "Bearer", store_id: 1, execute_url: "https://sandbox.shurjopayment.com/api/secret-pay" },
      "secret-pay": { checkout_url: "https://x", sp_order_id: "SP1" },
      verification: [{ sp_code: code, sp_message: "no" }],
    });
    const p = await bd.createPayment({ provider: "shurjopay", amount: 10, customer: CUSTOMER });
    assert.equal((await bd.handleCallback("shurjopay", p.orderId, {})).status, status);
  }
});

test("aamarPay: JSON checkout and trxcheck verification", async () => {
  let payStatus = "Pending";
  const { bd, calls } = make({
    "sandbox.aamarpay.com/jsonpost.php": { result: "true", payment_url: "https://sandbox.aamarpay.com/paynow.php?track=1" },
    "trxcheck/request.php": () => ({ pay_status: payStatus, amount: "120.00", pg_txnid: "AAM1", payment_type: "Upay", mer_txnid: "x" }),
    "shop.example.com": {},
  });
  const p = await bd.createPayment({ provider: "aamarpay", amount: 120, customer: CUSTOMER, description: "T-shirt" });
  assert.equal(p.paymentUrl, "https://sandbox.aamarpay.com/paynow.php?track=1");
  const body = JSON.parse(calls.find((c) => c.url.includes("jsonpost"))!.body);
  assert.equal(body.store_id, "aamarpaytest");
  assert.equal(body.tran_id, p.orderId);
  assert.equal(body.amount, "120.00");
  assert.equal(body.desc, "T-shirt");
  assert.equal(body.fail_url, `https://pay.example.com/callback/aamarpay/${p.orderId}?result=fail`);

  assert.equal((await bd.verifyPayment(p.orderId)).status, "pending");
  payStatus = "Successful";
  const done = await bd.handleCallback("aamarpay", p.orderId, { mer_txnid: p.orderId, pay_status: "Successful" });
  assert.equal(done.status, "success");
  assert.equal(done.transactionId, "AAM1");
  assert.equal(done.method, "Upay");
  const check = new URL(calls.filter((c) => c.url.includes("trxcheck")).at(-1)!.url);
  assert.equal(check.searchParams.get("request_id"), p.orderId);
});

test("aamarPay fail redirect with no result yet counts as failed", async () => {
  const { bd } = make({ jsonpost: { payment_url: "https://x" }, trxcheck: { status: "Invalid Request ID" } });
  const p = await bd.createPayment({ provider: "aamarpay", amount: 50, customer: CUSTOMER });
  assert.equal((await bd.handleCallback("aamarpay", p.orderId, { result: "fail" })).status, "failed");
});

test("SSLCommerz attempts map to success, failed and cancelled", async () => {
  let attempts: unknown[] = [];
  const { bd } = make({
    "gwprocess/v4/api.php": { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/1", sessionkey: "S1" },
    merchantTransIDvalidationAPI: () => ({ APIConnect: "DONE", element: attempts }),
  });
  const a = await bd.createPayment({ provider: "sslcommerz", amount: 100, customer: CUSTOMER });
  attempts = [{ status: "VALID", amount: "100.00", bank_tran_id: "BANK1", val_id: "V1", card_type: "BKASH-BKash" }];
  const ok = await bd.handleCallback("sslcommerz", a.orderId, { tran_id: a.orderId, status: "VALID" });
  assert.equal(ok.status, "success");
  assert.equal(ok.gateway.bankTranId, "BANK1");
  assert.equal(ok.method, "BKASH-BKash");

  const b = await bd.createPayment({ provider: "sslcommerz", amount: 100, customer: CUSTOMER });
  attempts = [];
  assert.equal((await bd.handleCallback("sslcommerz", b.orderId, { result: "cancel" })).status, "cancelled");
  const c = await bd.createPayment({ provider: "sslcommerz", amount: 100, customer: CUSTOMER });
  attempts = [{ status: "FAILED", amount: "100.00" }];
  assert.equal((await bd.handleCallback("sslcommerz", c.orderId, { result: "fail" })).status, "failed");
});

test("webhook retries and records a failure", async () => {
  let tries = 0;
  const fake = fakeFetch(BKASH_ROUTES);
  const fetchFn: FetchFn = async (input, init) => {
    if (String(input).includes("shop.example.com")) {
      tries++;
      return new Response("down", { status: 503 });
    }
    return fake.fn(input, init);
  };
  const bd = new BdConnector({ config: loadConfig(BASE_ENV), fetch: fetchFn, store: new MemoryStore(), webhookRetryDelaysMs: [0, 0, 0] });
  const p = await bd.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
  await bd.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "success" });
  await bd.flush();
  assert.equal(tries, 3);
  const note = (await bd.getPayment(p.orderId))!.notifications.find((n) => n.kind === "webhook")!;
  assert.equal(note.ok, false);
  assert.equal(note.error, "HTTP 503");
});

test("file store keeps payments between restarts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bdc-"));
  try {
    const fake = fakeFetch(BKASH_ROUTES);
    const config = loadConfig({ ...BASE_ENV, BD_CONNECTOR_DATA_DIR: dir });
    const first = new BdConnector({ config, fetch: fake.fn });
    const p = await first.createPayment({ provider: "bkash", amount: 500, customer: CUSTOMER });
    await Promise.all([first.handleCallback("bkash", p.orderId, { paymentID: "PAY1", status: "success" }), first.createPayment({ provider: "bkash", amount: 20, customer: CUSTOMER })]);
    await first.flush();
    const second = new BdConnector({ config, fetch: fake.fn, store: new FileStore(dir) });
    assert.equal((await second.getPayment(p.orderId))!.status, "success");
    assert.equal((await second.listPayments()).length, 2);
    assert.equal((await second.listPayments({ status: "success" })).length, 1);
    assert.equal((await second.listPayments({ search: "TRX9" })).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("summary totals", () => {
  const at = new Date("2026-10-09T06:00:00Z");
  const p = (status: Payment["status"], amount: number, paidAt: string | null) => ({ status, amount, paidAmount: null, paidAt }) as Payment;
  const s = summarize([p("success", 500, "2026-10-09T05:00:00Z"), p("success", 100, "2026-10-01T05:00:00Z"), p("failed", 50, null), p("pending", 70, null)], at);
  assert.equal(s.receivedToday, 500);
  assert.equal(s.receivedTotal, 600);
  assert.equal(s.byStatus.failed.count, 1);
  assert.equal(s.count, 4);
});

test(".env files are parsed", () => {
  const env = parseEnvFile(`# comment\nA=1\nexport B = two words \nC="quoted # not comment"\nD=x # comment\n\nbad line\n`);
  assert.deepEqual(env, { A: "1", B: "two words", C: "quoted # not comment", D: "x" });
});

async function serve(env: Record<string, string>, routes: Record<string, Route>) {
  const fake = fakeFetch(routes);
  const bd = new BdConnector({ config: loadConfig({ ...BASE_ENV, ...env }), fetch: fake.fn, store: new MemoryStore(), webhookRetryDelaysMs: [0] });
  const server = await startServer(bd, 0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { bd, base, calls: fake.calls, close: () => new Promise((r) => server.close(r)) };
}

const SSL_ROUTES = {
  "gwprocess/v4/api.php": { status: "SUCCESS", GatewayPageURL: "https://sandbox.sslcommerz.com/gw/1", sessionkey: "S1" },
  merchantTransIDvalidationAPI: { APIConnect: "DONE", element: [{ status: "VALID", amount: "300.00", bank_tran_id: "BANK3", val_id: "V3", card_type: "VISA" }] },
  "shop.example.com": {},
};

test("server: checkout page, gateway callback and signed return redirect", async () => {
  const { bd, base, close } = await serve({ BD_CONNECTOR_RETURN_URL: "https://shop.example.com/thanks" }, SSL_ROUTES);
  try {
    const form = await fetch(`${base}/pay?amount=300&description=Order%2042&lock=1`);
    const html = await form.text();
    assert.equal(form.status, 200);
    assert.match(html, /Pay Test Shop/);
    assert.match(html, /value="300" readonly/);
    assert.match(html, /value="sslcommerz"/);

    const start = await fetch(`${base}/pay`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ amount: "300", name: "Karim", phone: "01912345678", provider: "sslcommerz", description: "Order 42" }),
    });
    assert.equal(start.status, 303);
    assert.equal(start.headers.get("location"), "https://sandbox.sslcommerz.com/gw/1");
    const [payment] = await bd.listPayments();

    const back = await fetch(`${base}/callback/sslcommerz/${payment.orderId}`, {
      method: "POST",
      redirect: "manual",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ tran_id: payment.orderId, status: "VALID", val_id: "V3" }),
    });
    assert.equal(back.status, 303);
    const to = new URL(back.headers.get("location")!);
    assert.equal(to.origin + to.pathname, "https://shop.example.com/thanks");
    assert.equal(to.searchParams.get("status"), "success");
    assert.equal(to.searchParams.get("transaction_id"), "BANK3");
    assert.equal(to.searchParams.get("sig"), signReturn(payment.orderId, "success", "whsec"));

    const bad = await fetch(`${base}/pay`, { method: "POST", body: new URLSearchParams({ amount: "300", name: "K", phone: "12", provider: "sslcommerz" }) });
    assert.equal(bad.status, 400);
    assert.match(await bad.text(), /not a valid Bangladeshi mobile number/);
  } finally {
    await bd.flush();
    await close();
  }
});

test("server: receipt page when no return URL is set", async () => {
  const { bd, base, close } = await serve({}, SSL_ROUTES);
  try {
    const p = await bd.createPayment({ provider: "sslcommerz", amount: 300, customer: CUSTOMER });
    const back = await fetch(`${base}/callback/sslcommerz/${p.orderId}`, { redirect: "manual" });
    assert.equal(back.headers.get("location"), `https://pay.example.com/receipt/${p.orderId}`);
    const receipt = await (await fetch(`${base}/receipt/${p.orderId}`)).text();
    assert.match(receipt, /Payment successful/);
    assert.match(receipt, /BANK3/);
    assert.doesNotMatch(receipt, /01712345678/, "receipt does not show the phone number");
  } finally {
    await bd.flush();
    await close();
  }
});

test("server: JSON API needs the key and covers create, read, list and summary", async () => {
  const { bd, base, close } = await serve({ BD_CONNECTOR_API_KEY: "apikey" }, SSL_ROUTES);
  const auth = { Authorization: "Bearer apikey", "Content-Type": "application/json" };
  try {
    assert.equal((await fetch(`${base}/api/payments`)).status, 401);
    assert.equal((await fetch(`${base}/api/payments`, { headers: { Authorization: "Bearer nope" } })).status, 401);
    const created = await fetch(`${base}/api/payments`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ provider: "sslcommerz", amount: 300, customer: { name: "Rahim", phone: "01712345678" }, reference: "INV-7" }),
    });
    assert.equal(created.status, 201);
    const p = await created.json();
    assert.equal(p.paymentUrl, "https://sandbox.sslcommerz.com/gw/1");
    const verified = await (await fetch(`${base}/api/payments/${p.orderId}/verify`, { method: "POST", headers: auth })).json();
    assert.equal(verified.status, "success");
    assert.equal((await (await fetch(`${base}/api/payments/${p.orderId}`, { headers: auth })).json()).reference, "INV-7");
    assert.equal((await (await fetch(`${base}/api/payments?status=success`, { headers: auth })).json()).length, 1);
    assert.equal((await (await fetch(`${base}/api/summary`, { headers: auth })).json()).receivedTotal, 300);
    const bad = await fetch(`${base}/api/payments`, { method: "POST", headers: auth, body: JSON.stringify({ provider: "bkash", amount: -1 }) });
    assert.equal(bad.status, 400);
    assert.equal((await fetch(`${base}/api/payments/NOPE`, { headers: auth })).status, 404);
  } finally {
    await bd.flush();
    await close();
  }
});

test("server: API and dashboard are off unless a key or password is set", async () => {
  const { bd, base, close } = await serve({}, SSL_ROUTES);
  try {
    assert.equal((await fetch(`${base}/api/payments`)).status, 404);
    assert.equal((await fetch(`${base}/dashboard`)).status, 404);
    assert.deepEqual((await (await fetch(`${base}/health`)).json()).ok, true);
  } finally {
    await bd.flush();
    await close();
  }
});

test("server: dashboard asks for the password and lists payments", async () => {
  const { bd, base, close } = await serve({ BD_CONNECTOR_DASHBOARD_PASSWORD: "dash" }, SSL_ROUTES);
  try {
    const p = await bd.createPayment({ provider: "sslcommerz", amount: 300, customer: CUSTOMER, reference: "INV-9" });
    const denied = await fetch(`${base}/dashboard`);
    assert.equal(denied.status, 401);
    assert.match(denied.headers.get("www-authenticate")!, /Basic/);
    const auth = { Authorization: "Basic " + Buffer.from("owner:dash").toString("base64") };
    const html = await (await fetch(`${base}/dashboard`, { headers: auth })).text();
    assert.match(html, new RegExp(p.orderId));
    assert.match(html, /INV-9/);
    const csrf = html.match(/name="csrf" value="([a-f0-9]+)"/)![1];
    const forged = await fetch(`${base}/dashboard/verify/${p.orderId}`, { method: "POST", headers: auth, body: new URLSearchParams({ csrf: "x" }), redirect: "manual" });
    assert.equal(forged.status, 403);
    const check = await fetch(`${base}/dashboard/verify/${p.orderId}`, { method: "POST", headers: auth, body: new URLSearchParams({ csrf }), redirect: "manual" });
    assert.equal(check.status, 303);
    assert.equal((await bd.getPayment(p.orderId))!.status, "success");
  } finally {
    await bd.flush();
    await close();
  }
});
