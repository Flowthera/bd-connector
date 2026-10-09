import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, toAmount, type FetchFn } from "../http.js";

const ORIGINS: Record<Mode, string> = {
  sandbox: "https://sandbox.aamarpay.com",
  live: "https://secure.aamarpay.com",
};

type Reply = Record<string, any>;

export interface CreatePaymentInput {
  amount: number;
  orderId: string;
  description: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  successUrl?: string;
  failUrl?: string;
  cancelUrl?: string;
}

export function aamarpayStatus(payStatus: unknown): "success" | "failed" | "cancelled" | "pending" {
  const s = String(payStatus ?? "").toLowerCase();
  if (s === "successful" || s === "success") return "success";
  if (s.startsWith("fail")) return "failed";
  if (s.startsWith("cancel")) return "cancelled";
  return "pending";
}

/** aamarPay: one checkout for bKash, Nagad, Rocket, Upay, cards and more. */
export class Aamarpay {
  private readonly origin: string;

  constructor(
    private readonly config: NonNullable<Config["aamarpay"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.origin = ORIGINS[mode];
  }

  async createPayment(input: CreatePaymentInput) {
    const successUrl = input.successUrl ?? this.config.successUrl;
    const failUrl = input.failUrl ?? this.config.failUrl ?? successUrl;
    const cancelUrl = input.cancelUrl ?? this.config.cancelUrl ?? failUrl;
    if (!successUrl || !failUrl || !cancelUrl) {
      throw new ProviderError("aamarPay", "a success URL is required: pass success_url or set AAMARPAY_SUCCESS_URL", "missing_callback");
    }
    const reply = await requestJson<Reply>(this.fetchFn, "aamarPay", `${this.origin}/jsonpost.php`, {
      json: {
        store_id: this.config.storeId,
        signature_key: this.config.signatureKey,
        tran_id: input.orderId,
        amount: toAmount(input.amount),
        currency: "BDT",
        desc: input.description,
        cus_name: input.customerName,
        cus_email: input.customerEmail ?? "customer@example.com",
        cus_phone: input.customerPhone,
        success_url: successUrl,
        fail_url: failUrl,
        cancel_url: cancelUrl,
        type: "json",
      },
      timeoutMs: this.timeoutMs,
    });
    if (!reply.payment_url) {
      const reason = typeof reply === "object" ? Object.values(reply).filter((v) => typeof v === "string").join("; ") : String(reply);
      throw new ProviderError("aamarPay", reason || "could not open a payment page", "create_failed", reply);
    }
    return { mode: this.mode, orderId: input.orderId, paymentUrl: reply.payment_url as string };
  }

  /** Asks aamarPay for the authoritative result of a payment, by your order id. */
  async getPayment(orderId: string) {
    const search = new URLSearchParams({
      request_id: orderId,
      store_id: this.config.storeId,
      signature_key: this.config.signatureKey,
      type: "json",
    });
    const reply = await requestJson<Reply>(this.fetchFn, "aamarPay", `${this.origin}/api/v1/trxcheck/request.php?${search}`, {
      timeoutMs: this.timeoutMs,
    });
    return {
      mode: this.mode,
      orderId: reply.mer_txnid ?? orderId,
      status: aamarpayStatus(reply.pay_status),
      payStatus: reply.pay_status ?? reply.status ?? null,
      amount: reply.amount != null ? Number(reply.amount) : null,
      transactionId: reply.pg_txnid || reply.bank_trxid || null,
      method: reply.payment_type || null,
      customerName: reply.cus_name ?? null,
      customerPhone: reply.cus_phone ?? null,
      paidAt: reply.date_processed || reply.date || null,
    };
  }
}
