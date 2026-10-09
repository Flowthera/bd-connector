import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, toAmount, type FetchFn } from "../http.js";

const ORIGINS: Record<Mode, string> = {
  sandbox: "https://tokenized.sandbox.bka.sh",
  live: "https://tokenized.pay.bka.sh",
};
const VERSION = "v1.2.0-beta";

/** Mode "0011": a one-off payment where the customer is sent to bKash to approve it. */
const ONE_OFF_PAYMENT = "0011";

/** bKash codes meaning the payment was already executed; the money moved. */
const ALREADY_EXECUTED = new Set(["2062", "2068", "2116", "2117", "2119"]);

type BkashReply = Record<string, any>;

export interface CreatePaymentInput {
  amount: number;
  invoiceNumber: string;
  payerReference?: string;
  callbackUrl?: string;
}

export interface RefundInput {
  paymentId: string;
  trxId: string;
  amount?: number;
  reason?: string;
  sku?: string;
}

export class Bkash {
  private token?: { idToken: string; expiresAt: number };
  private readonly origin: string;

  constructor(
    private readonly config: NonNullable<Config["bkash"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.origin = ORIGINS[mode];
  }

  private url(path: string): string {
    return `${this.origin}/${VERSION}/tokenized/checkout/${path}`;
  }

  /** Grants a token and keeps it until shortly before it expires. bKash limits how often tokens may be granted. */
  private async idToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.idToken;
    const reply = await requestJson<BkashReply>(this.fetchFn, "bKash", this.url("token/grant"), {
      headers: { username: this.config.username, password: this.config.password },
      json: { app_key: this.config.appKey, app_secret: this.config.appSecret },
      timeoutMs: this.timeoutMs,
    });
    if (!reply.id_token) throw this.error(reply, "could not get an access token; check the bKash credentials");
    const lifetimeSeconds = Number(reply.expires_in) || 3600;
    this.token = { idToken: reply.id_token, expiresAt: Date.now() + (lifetimeSeconds - 300) * 1000 };
    return reply.id_token;
  }

  private async post(url: string, body: Record<string, unknown>): Promise<BkashReply> {
    const reply = await requestJson<BkashReply>(this.fetchFn, "bKash", url, {
      headers: { Authorization: await this.idToken(), "X-APP-Key": this.config.appKey },
      json: body,
      timeoutMs: this.timeoutMs,
    });
    const code = reply.statusCode ?? reply.errorCode;
    if (code && code !== "0000") throw this.error(reply);
    return reply;
  }

  private error(reply: BkashReply, fallback = "request failed"): ProviderError {
    const code = reply.statusCode ?? reply.errorCode;
    const message = reply.statusMessage ?? reply.errorMessage ?? reply.msg ?? fallback;
    return new ProviderError("bKash", code ? `${message} (code ${code})` : message, code, reply);
  }

  /** Starts a payment. The customer opens `bkashURL` to approve it, then call `executePayment`. */
  async createPayment(input: CreatePaymentInput) {
    const callbackURL = input.callbackUrl ?? this.config.callbackUrl;
    if (!callbackURL) {
      throw new ProviderError("bKash", "a callback URL is required: pass callback_url or set BKASH_CALLBACK_URL", "missing_callback");
    }
    const reply = await this.post(this.url("create"), {
      mode: ONE_OFF_PAYMENT,
      payerReference: input.payerReference ?? input.invoiceNumber,
      callbackURL,
      amount: toAmount(input.amount),
      currency: "BDT",
      intent: "sale",
      merchantInvoiceNumber: input.invoiceNumber,
    });
    return {
      mode: this.mode,
      paymentId: reply.paymentID,
      paymentUrl: reply.bkashURL,
      status: reply.transactionStatus,
      amount: reply.amount,
      invoiceNumber: reply.merchantInvoiceNumber,
      nextStep: "Send the customer to paymentUrl. After they approve, call bkash_execute_payment with this paymentId.",
    };
  }

  /** Completes an approved payment. If bKash says it was already executed, returns the current status instead. */
  async executePayment(paymentId: string) {
    try {
      const reply = await this.post(this.url("execute"), { paymentID: paymentId });
      return summarizePayment(reply, this.mode);
    } catch (error) {
      if (error instanceof ProviderError && error.code && ALREADY_EXECUTED.has(error.code)) {
        return this.getPayment(paymentId);
      }
      throw error;
    }
  }

  async getPayment(paymentId: string) {
    const reply = await this.post(this.url("payment/status"), { paymentID: paymentId });
    return summarizePayment(reply, this.mode);
  }

  /** Refunds all or part of a completed payment. Without an amount, refunds what bKash says is still refundable. */
  async refund(input: RefundInput) {
    let refundAmount: string;
    if (input.amount !== undefined) {
      refundAmount = toAmount(input.amount);
    } else {
      const status = await this.post(this.url("payment/status"), { paymentID: input.paymentId });
      if (!status.maxRefundableAmount) {
        throw new ProviderError("bKash", "no amount given and bKash reported nothing refundable", "nothing_refundable");
      }
      refundAmount = String(status.maxRefundableAmount);
    }
    const reply = await this.post(`${this.origin}/v2/tokenized-checkout/refund/payment/transaction`, {
      paymentId: input.paymentId,
      trxId: input.trxId,
      refundAmount,
      sku: input.sku?.trim() || "refund",
      reason: input.reason?.trim() || "Merchant refund",
    });
    return {
      mode: this.mode,
      refundTrxId: reply.refundTrxId,
      originalTrxId: reply.originalTrxId ?? input.trxId,
      status: reply.refundTransactionStatus,
      amount: reply.refundAmount ?? refundAmount,
      completedTime: reply.completedTime,
    };
  }
}

function summarizePayment(reply: BkashReply, mode: Mode) {
  return {
    mode,
    paymentId: reply.paymentID,
    trxId: reply.trxID ?? null,
    status: reply.transactionStatus,
    amount: reply.amount,
    currency: reply.currency ?? "BDT",
    invoiceNumber: reply.merchantInvoiceNumber ?? reply.merchantInvoice,
    customer: reply.customerMsisdn ?? null,
    executedAt: reply.paymentExecuteTime ?? null,
  };
}
