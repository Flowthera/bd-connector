import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { BdConnector, formatAmount } from "./connector.js";
import { ProviderError } from "./http.js";
import { PROVIDER_LABELS, PROVIDERS, type Payment, type PaymentStatus, type Provider } from "./types.js";

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

const MAX_BODY = 100_000;
const STATUSES: PaymentStatus[] = ["pending", "success", "failed", "cancelled", "refunded"];

export interface Summary {
  count: number;
  byStatus: Record<PaymentStatus, { count: number; amount: number }>;
  receivedToday: number;
  receivedTotal: number;
}

/** Totals for a list of payments. "Today" is the calendar day in Dhaka. */
export function summarize(payments: Payment[], at = new Date()): Summary {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Dhaka" });
  const today = day(at);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, amount: 0 }])) as Summary["byStatus"];
  let receivedToday = 0;
  let receivedTotal = 0;
  for (const p of payments) {
    byStatus[p.status].count++;
    byStatus[p.status].amount += p.amount;
    if (p.status === "success") {
      const value = p.paidAmount ?? p.amount;
      receivedTotal += value;
      if (p.paidAt && day(new Date(p.paidAt)) === today) receivedToday += value;
    }
  }
  return { count: payments.length, byStatus, receivedToday, receivedTotal };
}

/** Signs the customer redirect so your site can trust ?status=success without another lookup. */
export function signReturn(orderId: string, status: string, secret: string): string {
  return createHmac("sha256", secret).update(`${orderId}.${status}`).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function esc(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ProviderError("bd-connector", "request body too large", "too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readParams(req: IncomingMessage, url: URL): Promise<Record<string, string>> {
  const params: Record<string, string> = Object.fromEntries(url.searchParams);
  if (req.method !== "POST") return params;
  const body = await readBody(req);
  const type = req.headers["content-type"] ?? "";
  if (type.includes("application/json")) {
    const json = body ? JSON.parse(body) : {};
    for (const [k, v] of Object.entries(json)) params[k] = typeof v === "string" ? v : JSON.stringify(v);
  } else {
    Object.assign(params, Object.fromEntries(new URLSearchParams(body)));
  }
  return params;
}

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8", headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown) {
  send(res, status, JSON.stringify(value, null, 2), "application/json; charset=utf-8");
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5c6370;--line:#e3e6eb;--accent:#0f766e;--ok:#15803d;--bad:#b91c1c;--warn:#a16207}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a20;--text:#e8eaee;--muted:#9aa1ad;--line:#2a2f38;--accent:#2dd4bf;--ok:#4ade80;--bad:#f87171;--warn:#facc15}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1000px;margin:0 auto;padding:24px 16px}.narrow{max-width:460px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px;margin:0 0 16px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:0 0 12px}.muted{color:var(--muted)}
label{display:block;margin:12px 0 4px;font-weight:600;font-size:14px}
input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
button,.btn{display:inline-block;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.small{padding:5px 10px;font-size:13px}.full{width:100%;margin-top:18px}
.opt{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin:6px 0;font-weight:500}.opt input{width:auto}
.err{background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad);border-radius:8px;padding:10px 12px;margin:0 0 12px}
.badge{display:inline-block;border-radius:99px;padding:1px 9px;font-size:12px;font-weight:600;border:1px solid currentColor}
.success{color:var(--ok)}.failed,.cancelled{color:var(--bad)}.pending{color:var(--warn)}.refunded{color:var(--muted)}
.big{font-size:40px;line-height:1;margin:8px 0}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat .n{font-size:22px;font-weight:700}table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}.scroll{overflow-x:auto}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}dt{color:var(--muted)}dd{margin:0;word-break:break-all}
.sandbox{background:#facc15;color:#000;text-align:center;font-size:13px;padding:4px}
form.inline{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px}form.inline input,form.inline select{width:auto;flex:1;min-width:140px}
footer{text-align:center;color:var(--muted);font-size:12px;padding:16px}a{color:var(--accent)}`;

function page(title: string, body: string, mode: string, narrow = true): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>${CSS}</style></head><body>${
    mode === "sandbox" ? `<div class="sandbox">Sandbox mode: test payments only, no real money moves.</div>` : ""
  }<main class="${narrow ? "narrow" : ""}">${body}</main><footer>Payments by <a href="https://github.com/Flowthera/bd-connector">Flowthera BD Connector</a></footer></body></html>`;
}

function taka(amount: number): string {
  return `৳${formatAmount(amount)}`;
}

/**
 * The HTTP side of the connector: gateway callbacks, the checkout page, receipts, the JSON API
 * and the dashboard. Mount it in your own server (Express: app.use("/payments", handler)) or run
 * it alone with startServer().
 */
export function createHandler(bd: BdConnector): Handler {
  const { system } = bd.config;
  const secret = system.webhookSecret ?? system.apiKey;
  const csrf = system.dashboardPassword ? createHmac("sha256", system.dashboardPassword).update("csrf").digest("hex").slice(0, 32) : "";
  const base = () => system.publicUrl ?? "";

  function returnLocation(p: Payment): string {
    if (!system.returnUrl) return `${base()}/receipt/${p.orderId}`;
    const url = new URL(system.returnUrl);
    url.searchParams.set("order_id", p.orderId);
    if (p.reference) url.searchParams.set("reference", p.reference);
    url.searchParams.set("status", p.status);
    url.searchParams.set("amount", String(p.amount));
    if (p.transactionId) url.searchParams.set("transaction_id", p.transactionId);
    if (secret) url.searchParams.set("sig", signReturn(p.orderId, p.status, secret));
    return url.toString();
  }

  function checkoutForm(values: Record<string, string>, error?: string): string {
    const providers = bd.providers();
    const fixedAmount = values.lock === "1" && values.amount;
    const chosen = values.provider && providers.includes(values.provider as Provider) ? values.provider : providers[0];
    return page(
      `Pay ${system.businessName}`,
      `<div class="card"><h1>Pay ${esc(system.businessName)}</h1>${values.description ? `<p class="muted">${esc(values.description)}</p>` : ""}
      ${error ? `<div class="err">${esc(error)}</div>` : ""}
      <form method="post" action="${esc(base())}/pay">
        <label for="amount">Amount (Tk)</label>
        <input id="amount" name="amount" type="number" min="1" step="0.01" required value="${esc(values.amount)}" ${fixedAmount ? "readonly" : ""}>
        <label for="name">Your name</label><input id="name" name="name" required maxlength="80" value="${esc(values.name)}" autocomplete="name">
        <label for="phone">Mobile number</label><input id="phone" name="phone" required inputmode="tel" placeholder="01XXXXXXXXX" value="${esc(values.phone)}" autocomplete="tel">
        <label for="email">Email (optional)</label><input id="email" name="email" type="email" value="${esc(values.email)}" autocomplete="email">
        <label>Pay with</label>
        ${providers.map((p) => `<label class="opt"><input type="radio" name="provider" value="${p}" ${p === chosen ? "checked" : ""}> ${esc(PROVIDER_LABELS[p])}</label>`).join("")}
        <input type="hidden" name="description" value="${esc(values.description)}"><input type="hidden" name="reference" value="${esc(values.reference)}"><input type="hidden" name="lock" value="${esc(values.lock)}">
        <button class="full" type="submit">Continue to payment</button>
      </form></div>`,
      bd.mode,
    );
  }

  function receipt(p: Payment): string {
    const title = { success: "Payment successful", failed: "Payment failed", cancelled: "Payment cancelled", pending: "Payment not finished yet", refunded: "Payment refunded" }[p.status];
    return page(
      title,
      `<div class="card"><span class="badge ${p.status}">${esc(p.status)}</span><h1 style="margin-top:10px">${title}</h1>
      <div class="big">${taka(p.paidAmount ?? p.amount)}</div><p class="muted">${esc(system.businessName)}</p>
      <dl><dt>Order</dt><dd>${esc(p.reference ?? p.orderId)}</dd><dt>Paid with</dt><dd>${esc(PROVIDER_LABELS[p.provider])}</dd>
      ${p.transactionId ? `<dt>Transaction ID</dt><dd>${esc(p.transactionId)}</dd>` : ""}<dt>Date</dt><dd>${esc(new Date(p.paidAt ?? p.updatedAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }))}</dd></dl>
      ${p.status === "failed" || p.status === "cancelled" ? `<p>No money was taken. You can <a href="${esc(base())}/pay?amount=${p.amount}&description=${encodeURIComponent(p.description)}">try again</a>.</p>` : ""}
      ${p.status === "pending" ? `<p class="muted">If you already paid, refresh this page in a minute.</p>` : ""}</div>`,
      bd.mode,
    );
  }

  function dashboard(payments: Payment[], all: Payment[], q: Record<string, string>): string {
    const s = summarize(all);
    const rows = payments
      .map(
        (p) => `<tr><td>${esc(new Date(p.createdAt).toLocaleString("en-GB", { timeZone: "Asia/Dhaka" }))}</td>
        <td><b>${esc(p.orderId)}</b>${p.reference ? `<br><span class="muted">${esc(p.reference)}</span>` : ""}</td>
        <td>${esc(p.customer.name)}<br><span class="muted">${esc(p.customer.phone)}</span></td>
        <td>${taka(p.amount)}</td><td>${esc(p.provider)}${p.method ? `<br><span class="muted">${esc(p.method)}</span>` : ""}</td>
        <td><span class="badge ${p.status}">${p.status}</span>${p.message && p.status !== "success" ? `<br><span class="muted">${esc(p.message)}</span>` : ""}</td>
        <td>${esc(p.transactionId ?? "")}</td>
        <td>${p.status === "pending" ? `<form method="post" action="${esc(base())}/dashboard/verify/${esc(p.orderId)}"><input type="hidden" name="csrf" value="${csrf}"><button class="small">Check</button></form>` : ""}</td></tr>`,
      )
      .join("");
    return page(
      "Payments dashboard",
      `<h1>Payments</h1><p class="muted">${esc(system.businessName)} · ${bd.mode} mode · gateways: ${bd.providers().join(", ") || "none set up"}</p>
      <div class="stats"><div class="card stat"><div class="muted">Received today</div><div class="n">${taka(s.receivedToday)}</div></div>
      <div class="card stat"><div class="muted">Received total</div><div class="n">${taka(s.receivedTotal)}</div></div>
      <div class="card stat"><div class="muted">Successful</div><div class="n success">${s.byStatus.success.count}</div></div>
      <div class="card stat"><div class="muted">Failed or cancelled</div><div class="n failed">${s.byStatus.failed.count + s.byStatus.cancelled.count}</div></div>
      <div class="card stat"><div class="muted">Waiting</div><div class="n pending">${s.byStatus.pending.count}</div></div></div>
      <div class="card"><form class="inline" method="get" action="${esc(base())}/dashboard"><input name="search" placeholder="Search order, name, phone, trx" value="${esc(q.search)}">
      <select name="status"><option value="">All statuses</option>${STATUSES.map((st) => `<option ${q.status === st ? "selected" : ""}>${st}</option>`).join("")}</select>
      <button>Filter</button></form>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Order</th><th>Customer</th><th>Amount</th><th>Gateway</th><th>Status</th><th>Trx ID</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="muted">No payments yet.</td></tr>`}</tbody></table></div></div>`,
      bd.mode,
      false,
    );
  }

  function apiAuthorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    return Boolean(system.apiKey) && safeEqual(header, `Bearer ${system.apiKey}`);
  }

  function dashboardAuthorized(req: IncomingMessage): boolean {
    const header = req.headers.authorization ?? "";
    if (!system.dashboardPassword || !header.startsWith("Basic ")) return false;
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    return safeEqual(decoded.slice(decoded.indexOf(":") + 1), system.dashboardPassword);
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://local");
    const parts = url.pathname.split("/").filter(Boolean);
    const method = req.method ?? "GET";

    if (parts[0] === "health") return json(res, 200, { ok: true, mode: bd.mode, providers: bd.providers() });

    // Gateways send the customer back here. The result is confirmed with the gateway, then the
    // customer goes to your return URL or the receipt page.
    if (parts[0] === "callback" && parts.length === 3 && PROVIDERS.includes(parts[1] as Provider)) {
      const params = await readParams(req, url);
      try {
        const payment = await bd.handleCallback(parts[1] as Provider, parts[2], params);
        return redirect(res, returnLocation(payment));
      } catch (error) {
        return send(res, 400, page("Payment problem", `<div class="card"><h1>We could not confirm this payment</h1><p class="err">${esc((error as Error).message)}</p><p>If money left your account, contact ${esc(system.businessName)} with your order number.</p></div>`, bd.mode));
      }
    }

    if (parts[0] === "receipt" && parts.length === 2 && method === "GET") {
      let payment = await bd.getPayment(parts[1]);
      if (!payment) return send(res, 404, page("Not found", `<div class="card"><h1>Payment not found</h1></div>`, bd.mode));
      if (payment.status === "pending") payment = await bd.verifyPayment(payment.orderId).catch(() => payment!);
      return send(res, 200, receipt(payment));
    }

    if (parts[0] === "pay" && parts.length === 1) {
      if (!system.checkoutPage) return send(res, 404, "Not found", "text/plain");
      if (!bd.providers().length) return send(res, 503, page("Not ready", `<div class="card"><h1>Payments are not set up yet</h1><p>Add at least one gateway's keys.</p></div>`, bd.mode));
      if (method === "GET") return send(res, 200, checkoutForm(Object.fromEntries(url.searchParams)));
      const form = await readParams(req, url);
      try {
        const payment = await bd.createPayment({
          provider: form.provider as Provider,
          amount: Number(form.amount),
          customer: { name: form.name ?? "", phone: form.phone ?? "", email: form.email || undefined },
          description: form.description || undefined,
          reference: form.reference || undefined,
        });
        return redirect(res, payment.paymentUrl!);
      } catch (error) {
        return send(res, 400, checkoutForm(form, (error as Error).message));
      }
    }

    if (parts[0] === "api") {
      if (!system.apiKey) return json(res, 404, { error: "The API is off. Set BD_CONNECTOR_API_KEY to turn it on." });
      if (!apiAuthorized(req)) return json(res, 401, { error: "Missing or wrong API key. Send Authorization: Bearer <BD_CONNECTOR_API_KEY>." });
      try {
        if (parts[1] === "summary" && method === "GET") return json(res, 200, summarize(await bd.listPayments({ limit: 1_000_000 })));
        if (parts[1] === "providers" && method === "GET") return json(res, 200, { mode: bd.mode, providers: bd.providers() });
        if (parts[1] === "payments" && parts.length === 2 && method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          return json(res, 201, await bd.createPayment(body));
        }
        if (parts[1] === "payments" && parts.length === 2 && method === "GET") {
          const q = url.searchParams;
          return json(res, 200, await bd.listPayments({
            status: (q.get("status") as PaymentStatus) || undefined,
            provider: q.get("provider") || undefined,
            search: q.get("search") || undefined,
            limit: Number(q.get("limit")) || 100,
          }));
        }
        if (parts[1] === "payments" && parts.length === 3 && method === "GET") {
          const p = await bd.getPayment(parts[2]);
          return p ? json(res, 200, p) : json(res, 404, { error: "not found" });
        }
        if (parts[1] === "payments" && parts[3] === "verify" && method === "POST") return json(res, 200, await bd.verifyPayment(parts[2]));
        if (parts[1] === "payments" && parts[3] === "refund" && method === "POST") {
          const body = JSON.parse((await readBody(req)) || "{}");
          return json(res, 200, await bd.refundPayment(parts[2], body.amount, body.reason));
        }
        return json(res, 404, { error: "unknown API route" });
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : undefined;
        const status = code === "not_found" ? 404 : error instanceof SyntaxError || error instanceof ProviderError ? 400 : 500;
        return json(res, status, { error: (error as Error).message, code });
      }
    }

    if (parts[0] === "dashboard") {
      if (!system.dashboardPassword) return send(res, 404, "The dashboard is off. Set BD_CONNECTOR_DASHBOARD_PASSWORD to turn it on.", "text/plain");
      if (!dashboardAuthorized(req)) return send(res, 401, "Sign in with any user name and the dashboard password.", "text/plain", { "WWW-Authenticate": 'Basic realm="Payments", charset="UTF-8"' });
      if (parts[1] === "verify" && parts[2] && method === "POST") {
        const form = await readParams(req, url);
        if (!safeEqual(form.csrf ?? "", csrf)) return send(res, 403, "Bad form token", "text/plain");
        await bd.verifyPayment(parts[2]).catch(() => undefined);
        return redirect(res, `${base()}/dashboard`);
      }
      const q = Object.fromEntries(url.searchParams);
      const all = await bd.listPayments({ limit: 1_000_000 });
      const shown = await bd.listPayments({ status: (q.status as PaymentStatus) || undefined, search: q.search, limit: 300 });
      return send(res, 200, dashboard(shown, all, q));
    }

    if (parts.length === 0 && method === "GET") {
      return redirect(res, system.checkoutPage ? `${base()}/pay` : `${base()}/health`);
    }
    return send(res, 404, "Not found", "text/plain");
  }

  return (req, res) => {
    route(req, res).catch((error) => {
      console.error("bd-connector:", error);
      if (!res.headersSent) send(res, 500, "Something went wrong", "text/plain");
      else res.end();
    });
  };
}

/** Runs the connector as its own web server. */
export function startServer(bd: BdConnector, port = bd.config.system.port): Promise<Server> {
  const server = createServer(createHandler(bd));
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
