import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, toAmount, type FetchFn } from "../http.js";

const ORIGINS: Record<Mode, string> = {
  sandbox: "https://sandbox.shurjopayment.com",
  live: "https://engine.shurjopayment.com",
};

type Reply = Record<string, any>;

export interface CreatePaymentInput {
  amount: number;
  orderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerCity?: string;
  customerEmail?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

/** shurjoPay codes: 1000 paid, 1001 declined, 1002 cancelled. Anything else is still open. */
export function shurjopayStatus(code: unknown): "success" | "failed" | "cancelled" | "pending" {
  switch (String(code)) {
    case "1000":
      return "success";
    case "1001":
      return "failed";
    case "1002":
      return "cancelled";
    default:
      return "pending";
  }
}

/** shurjoPay: one checkout for bKash, Nagad, Rocket, Upay, cards and net banking. */
export class Shurjopay {
  private readonly origin: string;
  private token?: { value: string; type: string; storeId: string; executeUrl: string; expiresAt: number };

  constructor(
    private readonly config: NonNullable<Config["shurjopay"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.origin = ORIGINS[mode];
  }

  private async auth() {
    if (this.token && this.token.expiresAt > Date.now()) return this.token;
    const reply = await requestJson<Reply>(this.fetchFn, "shurjoPay", `${this.origin}/api/get_token`, {
      json: { username: this.config.username, password: this.config.password },
      timeoutMs: this.timeoutMs,
    });
    if (!reply.token) {
      throw new ProviderError("shurjoPay", reply.message || "could not get an access token; check the shurjoPay credentials", String(reply.sp_code ?? "auth_failed"), reply);
    }
    const lifetime = Number(reply.expires_in) || 3600;
    this.token = {
      value: reply.token,
      type: reply.token_type || "Bearer",
      storeId: String(reply.store_id),
      executeUrl: reply.execute_url || `${this.origin}/api/secret-pay`,
      expiresAt: Date.now() + Math.max(lifetime - 120, 30) * 1000,
    };
    return this.token;
  }

  async createPayment(input: CreatePaymentInput) {
    const returnUrl = input.returnUrl ?? this.config.returnUrl;
    if (!returnUrl) {
      throw new ProviderError("shurjoPay", "a return URL is required: pass return_url or set SHURJOPAY_RETURN_URL", "missing_callback");
    }
    const token = await this.auth();
    const reply = await requestJson<Reply>(this.fetchFn, "shurjoPay", token.executeUrl, {
      json: {
        prefix: this.config.prefix,
        token: token.value,
        store_id: token.storeId,
        return_url: returnUrl,
        cancel_url: input.cancelUrl ?? returnUrl,
        amount: Number(toAmount(input.amount)),
        order_id: input.orderId,
        currency: "BDT",
        customer_name: input.customerName,
        customer_phone: input.customerPhone,
        customer_email: input.customerEmail ?? "",
        customer_address: input.customerAddress ?? "Dhaka",
        customer_city: input.customerCity ?? "Dhaka",
        customer_post_code: "1000",
        client_ip: "127.0.0.1",
      },
      timeoutMs: this.timeoutMs,
    });
    if (!reply.checkout_url) {
      throw new ProviderError("shurjoPay", reply.message || reply.sp_message || "could not open a payment page", String(reply.sp_code ?? "create_failed"), reply);
    }
    return {
      mode: this.mode,
      spOrderId: reply.sp_order_id as string,
      orderId: input.orderId,
      paymentUrl: reply.checkout_url as string,
    };
  }

  /** Asks shurjoPay for the authoritative result, using the sp_order_id from createPayment. */
  async getPayment(spOrderId: string) {
    const token = await this.auth();
    const reply = await requestJson<Reply | Reply[]>(this.fetchFn, "shurjoPay", `${this.origin}/api/verification`, {
      headers: { Authorization: `${token.type} ${token.value}` },
      json: { order_id: spOrderId },
      timeoutMs: this.timeoutMs,
    });
    const row: Reply = Array.isArray(reply) ? (reply[0] ?? {}) : reply;
    return {
      mode: this.mode,
      spOrderId,
      orderId: row.customer_order_id ?? null,
      status: shurjopayStatus(row.sp_code),
      code: row.sp_code ?? null,
      message: row.sp_message ?? row.message ?? null,
      amount: row.amount != null ? Number(row.amount) : null,
      receivedAmount: row.received_amount != null ? Number(row.received_amount) : null,
      transactionId: row.bank_trx_id || null,
      method: row.method || null,
      customerName: row.name ?? null,
      customerPhone: row.phone_no ?? null,
      paidAt: row.date_time ?? null,
    };
  }
}
