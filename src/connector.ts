import { createHmac, randomBytes } from "node:crypto";
import { loadConfig, type Config } from "./config.js";
import { ProviderError, type FetchFn } from "./http.js";
import { Aamarpay } from "./providers/aamarpay.js";
import { Bkash } from "./providers/bkash.js";
import { BulkSmsBd, normalizeNumber } from "./providers/bulksmsbd.js";
import { Nagad } from "./providers/nagad.js";
import { Shurjopay } from "./providers/shurjopay.js";
import { Sslcommerz } from "./providers/sslcommerz.js";
import { FileStore, type ListOptions, type PaymentStore } from "./store.js";
import {
  PROVIDERS,
  type CreatePaymentInput,
  type Notification,
  type Payment,
  type PaymentEvent,
  type PaymentStatus,
  type Provider,
} from "./types.js";

export interface ConnectorOptions {
  /** Ready config. Without it, settings are read from `env` (default: process.env). */
  config?: Config;
  env?: Record<string, string | undefined>;
  /** Where payments are kept. Default: a JSON file in BD_CONNECTOR_DATA_DIR. */
  store?: PaymentStore;
  fetch?: FetchFn;
  /** Waits between webhook attempts. Default: 0s, 5s, 30s. */
  webhookRetryDelaysMs?: number[];
}

type Listener = (payment: Payment, event: PaymentEvent) => void | Promise<void>;

interface Outcome {
  status: PaymentStatus;
  transactionId?: string | null;
  paidAmount?: number | null;
  method?: string | null;
  message?: string | null;
  /** The gateway's own time text, kept in gateway.paidAtText. */
  paidAt?: string | null;
  gateway?: Record<string, string>;
}

const FINAL: PaymentStatus[] = ["success", "failed", "cancelled", "refunded"];

/** An order id every gateway accepts: letters and digits only, 16 characters. */
export function newOrderId(): string {
  const time = Date.now().toString(36).toUpperCase();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const rand = [...randomBytes(6)].map((b) => alphabet[b % alphabet.length]).join("");
  return `BD${time}${rand}`.slice(0, 20);
}

export function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

/** Signs a webhook body. Your server compares this with the X-BD-Signature header. */
export function signWebhook(body: string, secret: string): string {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}

/** Checks a webhook's X-BD-Signature header in constant time. */
export function verifyWebhookSignature(body: string, signature: string | null | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = Buffer.from(signWebhook(body, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
  return diff === 0;
}

function fill(template: string, p: Payment, business: string): string {
  const values: Record<string, string> = {
    business,
    amount: formatAmount(p.paidAmount ?? p.amount),
    orderId: p.orderId,
    reference: p.reference ?? p.orderId,
    transactionId: p.transactionId ?? "-",
    provider: p.provider,
    customerName: p.customer.name,
    customerPhone: p.customer.phone,
    status: p.status,
  };
  return template.replace(/\{(\w+)\}/g, (all, key) => values[key] ?? all);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * The whole payment cycle in one object: start a payment with any gateway, confirm it when the
 * customer comes back, keep a record, and tell your system (webhook, SMS, events) whether it
 * succeeded or failed.
 */
export class BdConnector {
  readonly config: Config;
  readonly store: PaymentStore;
  readonly bkash?: Bkash;
  readonly sslcommerz?: Sslcommerz;
  readonly shurjopay?: Shurjopay;
  readonly aamarpay?: Aamarpay;
  readonly sms?: BulkSmsBd;
  private readonly nagadClient?: Nagad;
  private readonly nagadError?: unknown;
  private readonly fetchFn: FetchFn;
  private readonly retryDelays: number[];
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly running = new Set<Promise<unknown>>();

  constructor(options: ConnectorOptions = {}) {
    this.config = options.config ?? loadConfig(options.env ?? process.env);
    this.fetchFn = options.fetch ?? fetch;
    this.store = options.store ?? new FileStore(this.config.system.dataDir);
    this.retryDelays = options.webhookRetryDelaysMs ?? [0, 5_000, 30_000];
    const { mode, timeoutMs } = this.config;
    const f = this.fetchFn;
    if (this.config.bkash) this.bkash = new Bkash(this.config.bkash, mode, timeoutMs, f);
    if (this.config.sslcommerz) this.sslcommerz = new Sslcommerz(this.config.sslcommerz, mode, timeoutMs, f);
    if (this.config.shurjopay) this.shurjopay = new Shurjopay(this.config.shurjopay, mode, timeoutMs, f);
    if (this.config.aamarpay) this.aamarpay = new Aamarpay(this.config.aamarpay, mode, timeoutMs, f);
    if (this.config.bulksmsbd) this.sms = new BulkSmsBd(this.config.bulksmsbd, mode, timeoutMs, f);
    try {
      if (this.config.nagad) this.nagadClient = new Nagad(this.config.nagad, mode, timeoutMs, f);
    } catch (error) {
      // A bad Nagad key is reported when Nagad is used, so the other gateways keep working.
      this.nagadError = error;
    }
  }

  get mode() {
    return this.config.mode;
  }

  get nagad(): Nagad | undefined {
    if (this.nagadError) throw this.nagadError;
    return this.nagadClient;
  }

  /** Gateways that have credentials set. */
  providers(): Provider[] {
    return PROVIDERS.filter((p) => (p === "nagad" ? Boolean(this.config.nagad) : Boolean(this[p])));
  }

  /** Runs `listener` when a payment succeeds, fails, is cancelled or refunded. Use "payment.*" for all. */
  on(event: PaymentEvent | "payment.*", listener: Listener): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  /** Waits for webhooks, SMS and listeners that are still running. Call before shutting down. */
  async flush(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  /** The URL a gateway sends the customer back to. Point your callback route here. */
  callbackUrl(provider: Provider, orderId: string, result?: string): string {
    const base = this.config.system.publicUrl;
    if (!base) {
      throw new ProviderError("bd-connector", "set BD_CONNECTOR_PUBLIC_URL to the address where this connector is reachable", "missing_public_url");
    }
    return `${base}/callback/${provider}/${orderId}${result ? `?result=${result}` : ""}`;
  }

  private need<T>(client: T | undefined, provider: Provider): T {
    if (!client) {
      throw new ProviderError("bd-connector", `${provider} is not set up. Add its keys to the environment (see docs/configuration.md).`, "not_configured");
    }
    return client;
  }

  /** Starts a payment. Send the customer to `paymentUrl` on the result. */
  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    if (!PROVIDERS.includes(input.provider)) {
      throw new ProviderError("bd-connector", `unknown provider "${input.provider}". Use one of: ${PROVIDERS.join(", ")}`, "unknown_provider");
    }
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ProviderError("bd-connector", "amount must be a positive number of taka", "invalid_amount");
    }
    if (input.provider === "sslcommerz" && input.amount < 10) {
      throw new ProviderError("SSLCommerz", "the minimum amount is 10 taka", "invalid_amount");
    }
    const name = input.customer?.name?.trim();
    if (!name) throw new ProviderError("bd-connector", "customer.name is required", "missing_customer");
    const phone = normalizeNumber(input.customer.phone ?? "").slice(2);
    const amount = Math.round(input.amount * 100) / 100;
    const orderId = newOrderId();
    const description = input.description?.trim() || input.reference?.trim() || `Order ${orderId}`;
    const customer = { ...input.customer, name, phone };
    const cb = (result?: string) => this.callbackUrl(input.provider, orderId, result);

    let paymentUrl: string;
    let gatewayReference: string | null = null;
    const gateway: Record<string, string> = {};
    switch (input.provider) {
      case "bkash": {
        const r = await this.need(this.bkash, "bkash").createPayment({ amount, invoiceNumber: orderId, payerReference: phone, callbackUrl: cb() });
        paymentUrl = r.paymentUrl;
        gatewayReference = gateway.paymentID = r.paymentId;
        break;
      }
      case "nagad": {
        const r = await this.need(this.nagad, "nagad").createPayment({ amount, orderId, callbackUrl: cb() });
        paymentUrl = r.paymentUrl;
        gatewayReference = gateway.paymentRefId = r.paymentRefId;
        break;
      }
      case "sslcommerz": {
        const r = await this.need(this.sslcommerz, "sslcommerz").createSession({
          amount,
          tranId: orderId,
          productName: description.slice(0, 100),
          customerName: name,
          customerPhone: phone,
          customerEmail: customer.email,
          customerAddress: customer.address,
          customerCity: customer.city,
          successUrl: cb(),
          failUrl: cb("fail"),
          cancelUrl: cb("cancel"),
        });
        paymentUrl = r.paymentUrl;
        gatewayReference = gateway.sessionKey = r.sessionKey;
        break;
      }
      case "shurjopay": {
        const r = await this.need(this.shurjopay, "shurjopay").createPayment({
          amount,
          orderId,
          customerName: name,
          customerPhone: phone,
          customerEmail: customer.email,
          customerAddress: customer.address,
          customerCity: customer.city,
          returnUrl: cb(),
          cancelUrl: cb("cancel"),
        });
        paymentUrl = r.paymentUrl;
        gatewayReference = gateway.spOrderId = r.spOrderId;
        break;
      }
      case "aamarpay": {
        const r = await this.need(this.aamarpay, "aamarpay").createPayment({
          amount,
          orderId,
          description,
          customerName: name,
          customerPhone: phone,
          customerEmail: customer.email,
          successUrl: cb(),
          failUrl: cb("fail"),
          cancelUrl: cb("cancel"),
        });
        paymentUrl = r.paymentUrl;
        break;
      }
    }

    const at = now();
    const payment: Payment = {
      orderId,
      reference: input.reference?.trim() || null,
      provider: input.provider,
      mode: this.mode,
      status: "pending",
      paid: false,
      amount,
      paidAmount: null,
      currency: "BDT",
      description,
      customer,
      transactionId: null,
      gatewayReference,
      gateway,
      method: null,
      message: null,
      metadata: { ...(input.metadata ?? {}) },
      paymentUrl,
      createdAt: at,
      updatedAt: at,
      paidAt: null,
      refunds: [],
      notifications: [],
    };
    await this.store.put(payment);
    return payment;
  }

  async getPayment(orderId: string): Promise<Payment | undefined> {
    return this.store.get(orderId);
  }

  async listPayments(options?: ListOptions): Promise<Payment[]> {
    return this.store.list(options);
  }

  private async load(orderId: string): Promise<Payment> {
    const payment = await this.store.get(orderId);
    if (!payment) throw new ProviderError("bd-connector", `no payment with orderId ${orderId}`, "not_found");
    return payment;
  }

  /**
   * Call when a gateway sends the customer back (the built-in server does this for you). The
   * result is checked with the gateway itself, never trusted from the redirect.
   */
  async handleCallback(provider: Provider, orderId: string, params: Record<string, string | undefined> = {}): Promise<Payment> {
    const payment = await this.load(orderId);
    if (payment.provider !== provider) {
      throw new ProviderError("bd-connector", `order ${orderId} was not paid with ${provider}`, "provider_mismatch");
    }
    if (FINAL.includes(payment.status)) return payment;

    if (provider === "bkash") {
      if (params.paymentID && params.paymentID !== payment.gateway.paymentID) {
        throw new ProviderError("bKash", "the callback's paymentID does not match this order", "reference_mismatch");
      }
      const status = params.status?.toLowerCase();
      if (status === "cancel") return this.apply(payment, { status: "cancelled", message: "The customer cancelled in bKash." });
      if (status === "failure") return this.apply(payment, { status: "failed", message: "bKash reported the payment failed." });
      if (status === "success") {
        try {
          const r = await this.bkash!.executePayment(payment.gateway.paymentID);
          return this.apply(payment, bkashOutcome(r));
        } catch (error) {
          if (error instanceof ProviderError && error.code !== "network_error") {
            return this.apply(payment, { status: "failed", message: error.message });
          }
          throw error;
        }
      }
    }
    return this.apply(payment, await this.check(payment, params.result));
  }

  /** Asks the gateway for the current result and updates the record. Safe to call any time. */
  async verifyPayment(orderId: string): Promise<Payment> {
    const payment = await this.load(orderId);
    if (FINAL.includes(payment.status)) return payment;
    return this.apply(payment, await this.check(payment));
  }

  private async check(p: Payment, hint?: string): Promise<Outcome> {
    switch (p.provider) {
      case "bkash":
        return bkashOutcome(await this.need(this.bkash, "bkash").getPayment(p.gateway.paymentID));
      case "nagad": {
        const r = await this.need(this.nagad, "nagad").getPayment(p.gateway.paymentRefId);
        const s = String(r.status).toLowerCase();
        const status: PaymentStatus = r.paid ? "success" : /abort|cancel/.test(s) ? "cancelled" : /fail|expired/.test(s) ? "failed" : "pending";
        return { status, transactionId: r.transactionId, paidAmount: num(r.amount), paidAt: r.paidAt, method: "Nagad", message: `Nagad status: ${r.status}` };
      }
      case "sslcommerz": {
        const r = await this.need(this.sslcommerz, "sslcommerz").getPayment(p.orderId);
        const paid = r.attempts.find((a) => a.status === "VALID" || a.status === "VALIDATED");
        if (paid) {
          return {
            status: "success",
            transactionId: paid.bankTranId,
            paidAmount: num(paid.amount),
            method: paid.cardType ?? null,
            paidAt: paid.date ?? null,
            gateway: { bankTranId: paid.bankTranId, valId: paid.valId },
          };
        }
        const last = r.attempts[0]?.status;
        if (last === "CANCELLED" || (!last && hint === "cancel")) return { status: "cancelled", message: "The customer cancelled." };
        if (last === "FAILED" || last === "EXPIRED" || (!last && hint === "fail")) return { status: "failed", message: `SSLCommerz status: ${last ?? "failed"}` };
        return { status: "pending", message: last ? `SSLCommerz status: ${last}` : "No payment attempt yet." };
      }
      case "shurjopay": {
        const r = await this.need(this.shurjopay, "shurjopay").getPayment(p.gateway.spOrderId);
        const status = r.status === "pending" && hint === "cancel" ? "cancelled" : r.status;
        return { status, transactionId: r.transactionId, paidAmount: r.amount, method: r.method, paidAt: r.paidAt, message: r.message };
      }
      case "aamarpay": {
        const r = await this.need(this.aamarpay, "aamarpay").getPayment(p.orderId);
        let status = r.status;
        if (status === "pending" && hint === "cancel") status = "cancelled";
        if (status === "pending" && hint === "fail") status = "failed";
        return { status, transactionId: r.transactionId, paidAmount: r.amount, method: r.method, paidAt: r.paidAt, message: r.payStatus ? `aamarPay status: ${r.payStatus}` : null };
      }
    }
  }

  private async apply(payment: Payment, outcome: Outcome): Promise<Payment> {
    let { status } = outcome;
    let message = outcome.message ?? payment.message;
    if (status === "success" && outcome.paidAmount != null && Math.abs(outcome.paidAmount - payment.amount) > 0.009) {
      status = "failed";
      message = `Amount mismatch: expected ${payment.amount}, gateway reported ${outcome.paidAmount}. Not marked as paid.`;
    }
    const before = payment.status;
    const updated: Payment = {
      ...payment,
      status,
      paid: status === "success",
      paidAmount: outcome.paidAmount ?? payment.paidAmount,
      transactionId: outcome.transactionId ?? payment.transactionId,
      method: outcome.method ?? payment.method,
      message,
      gateway: { ...payment.gateway, ...(outcome.gateway ?? {}), ...(outcome.paidAt ? { paidAtText: String(outcome.paidAt) } : {}) },
      paidAt: status === "success" ? (payment.paidAt ?? now()) : payment.paidAt,
      updatedAt: now(),
    };
    await this.store.put(updated);
    if (before !== status && status !== "pending") this.track(this.notify(updated, `payment.${status}` as PaymentEvent));
    return updated;
  }

  /** Refunds a bKash or SSLCommerz payment. Leave out amount for the full remaining amount. */
  async refundPayment(orderId: string, amount?: number, reason = "Refund"): Promise<Payment> {
    const p = await this.load(orderId);
    if (p.status !== "success") throw new ProviderError("bd-connector", `only successful payments can be refunded (this one is ${p.status})`, "not_refundable");
    const already = p.refunds.reduce((sum, r) => sum + r.amount, 0);
    const remaining = Math.round(((p.paidAmount ?? p.amount) - already) * 100) / 100;
    const value = amount ?? remaining;
    if (value <= 0 || value > remaining + 0.009) {
      throw new ProviderError("bd-connector", `refund amount must be between 0 and ${remaining}`, "invalid_amount");
    }
    let refund;
    if (p.provider === "bkash") {
      const r = await this.need(this.bkash, "bkash").refund({ paymentId: p.gateway.paymentID, trxId: p.transactionId ?? "", amount: value, reason });
      refund = { amount: value, status: String(r.status ?? "Completed"), reference: r.refundTrxId ?? null, createdAt: now() };
    } else if (p.provider === "sslcommerz") {
      const r = await this.need(this.sslcommerz, "sslcommerz").refund({ bankTranId: p.gateway.bankTranId, amount: value, remarks: reason });
      refund = { amount: value, status: String(r.status ?? "initiated"), reference: r.refundRefId ?? null, createdAt: now() };
    } else {
      throw new ProviderError("bd-connector", `${p.provider} refunds are made in the ${p.provider} merchant panel`, "refund_not_supported");
    }
    const refunds = [...p.refunds, refund];
    const full = already + value >= (p.paidAmount ?? p.amount) - 0.009;
    const updated: Payment = { ...p, refunds, status: full ? "refunded" : p.status, paid: !full, updatedAt: now() };
    await this.store.put(updated);
    this.track(this.notify(updated, "payment.refunded"));
    return updated;
  }

  private track(task: Promise<unknown>) {
    const t = task.catch((error) => console.error("bd-connector: notification error:", error)).finally(() => this.running.delete(t));
    this.running.add(t);
  }

  private async notify(payment: Payment, event: PaymentEvent): Promise<void> {
    const notes: Notification[] = [];
    for (const key of [event, "payment.*"]) {
      for (const listener of this.listeners.get(key) ?? []) {
        try {
          await listener(payment, event);
        } catch (error) {
          console.error(`bd-connector: ${event} listener failed:`, error);
        }
      }
    }
    const { system } = this.config;
    if (system.webhookUrl) notes.push(await this.sendWebhook(system.webhookUrl, payment, event));
    if (this.sms && event !== "payment.refunded") {
      const t = system.smsTemplates;
      const sends: [string, string][] = [];
      if (event === "payment.success") {
        if (system.smsNotifyCustomer) sends.push([payment.customer.phone, fill(t.customerSuccess, payment, system.businessName)]);
        for (const n of system.smsOwnerNumbers) sends.push([n, fill(t.ownerSuccess, payment, system.businessName)]);
      } else {
        for (const n of system.smsOwnerNumbers) sends.push([n, fill(t.ownerFailed, payment, system.businessName)]);
      }
      for (const [to, text] of sends) {
        try {
          const r = await this.sms.send([to], text);
          notes.push({ kind: "sms", to, event, ok: true, dryRun: !r.sent, at: now() });
        } catch (error) {
          notes.push({ kind: "sms", to, event, ok: false, error: (error as Error).message, at: now() });
        }
      }
    }
    if (notes.length) {
      const latest = (await this.store.get(payment.orderId)) ?? payment;
      await this.store.put({ ...latest, notifications: [...latest.notifications, ...notes] });
    }
  }

  private async sendWebhook(url: string, payment: Payment, event: PaymentEvent): Promise<Notification> {
    const body = JSON.stringify({ event, sentAt: now(), payment });
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-BD-Event": event, "User-Agent": "flowthera-bd-connector" };
    if (this.config.system.webhookSecret) headers["X-BD-Signature"] = signWebhook(body, this.config.system.webhookSecret);
    let error = "";
    for (const delay of this.retryDelays) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      try {
        const res = await this.fetchFn(url, { method: "POST", headers, body, signal: AbortSignal.timeout(this.config.timeoutMs) });
        if (res.ok) return { kind: "webhook", to: url, event, ok: true, at: now() };
        error = `HTTP ${res.status}`;
      } catch (e) {
        error = (e as Error).message;
      }
    }
    return { kind: "webhook", to: url, event, ok: false, error, at: now() };
  }
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function bkashOutcome(r: Awaited<ReturnType<Bkash["getPayment"]>>): Outcome {
  const s = String(r.status ?? "").toLowerCase();
  const status: PaymentStatus = s === "completed" ? "success" : s === "cancelled" ? "cancelled" : s === "failed" || s === "expired" ? "failed" : "pending";
  return {
    status,
    transactionId: r.trxId,
    paidAmount: num(r.amount),
    method: "bKash",
    paidAt: r.executedAt,
    message: `bKash status: ${r.status}`,
    gateway: r.trxId ? { trxID: r.trxId } : undefined,
  };
}
