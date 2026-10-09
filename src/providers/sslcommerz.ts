import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, toAmount, type FetchFn } from "../http.js";

const ORIGINS: Record<Mode, string> = {
  sandbox: "https://sandbox.sslcommerz.com",
  live: "https://securepay.sslcommerz.com",
};

type Reply = Record<string, any>;

export interface CreateSessionInput {
  amount: number;
  tranId: string;
  productName: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerAddress?: string;
  customerCity?: string;
  successUrl?: string;
  failUrl?: string;
  cancelUrl?: string;
}

export interface RefundInput {
  bankTranId: string;
  amount: number;
  remarks: string;
  referenceId?: string;
}

export class Sslcommerz {
  private readonly origin: string;

  constructor(
    private readonly config: NonNullable<Config["sslcommerz"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.origin = ORIGINS[mode];
  }

  private credentials() {
    return { store_id: this.config.storeId, store_passwd: this.config.storePassword };
  }

  private async query(params: Record<string, string>): Promise<Reply> {
    const search = new URLSearchParams({ ...params, ...this.credentials(), v: "1", format: "json" });
    return requestJson<Reply>(
      this.fetchFn,
      "SSLCommerz",
      `${this.origin}/validator/api/merchantTransIDvalidationAPI.php?${search}`,
      { timeoutMs: this.timeoutMs },
    );
  }

  /** Opens a hosted checkout session. The customer pays at `paymentUrl`. */
  async createSession(input: CreateSessionInput) {
    const successUrl = input.successUrl ?? this.config.successUrl;
    const failUrl = input.failUrl ?? this.config.failUrl ?? successUrl;
    const cancelUrl = input.cancelUrl ?? this.config.cancelUrl ?? failUrl;
    if (!successUrl || !failUrl || !cancelUrl) {
      throw new ProviderError(
        "SSLCommerz",
        "a success URL is required: pass success_url or set SSLCOMMERZ_SUCCESS_URL",
        "missing_redirect_url",
      );
    }
    const reply = await requestJson<Reply>(this.fetchFn, "SSLCommerz", `${this.origin}/gwprocess/v4/api.php`, {
      form: {
        ...this.credentials(),
        total_amount: toAmount(input.amount),
        currency: "BDT",
        tran_id: input.tranId,
        success_url: successUrl,
        fail_url: failUrl,
        cancel_url: cancelUrl,
        cus_name: input.customerName,
        cus_email: input.customerEmail ?? "customer@example.com",
        cus_phone: input.customerPhone,
        cus_add1: input.customerAddress ?? "Dhaka",
        cus_city: input.customerCity ?? "Dhaka",
        cus_country: "Bangladesh",
        shipping_method: "NO",
        product_name: input.productName,
        product_category: "General",
        product_profile: "general",
      },
      timeoutMs: this.timeoutMs,
    });
    if (reply.status !== "SUCCESS" || !reply.GatewayPageURL) {
      throw new ProviderError("SSLCommerz", reply.failedreason || "could not open a payment session", "session_failed", reply);
    }
    return {
      mode: this.mode,
      tranId: input.tranId,
      sessionKey: reply.sessionkey,
      paymentUrl: reply.GatewayPageURL,
      nextStep: "Send the customer to paymentUrl, then check the result with sslcommerz_get_payment and this tranId.",
    };
  }

  /** Looks up a payment by the merchant's transaction id. */
  async getPayment(tranId: string) {
    const reply = await this.query({ tran_id: tranId });
    const attempts: Reply[] = Array.isArray(reply.element) ? reply.element : [];
    if (reply.APIConnect && reply.APIConnect !== "DONE") {
      throw new ProviderError("SSLCommerz", `lookup failed (${reply.APIConnect})`, reply.APIConnect, reply);
    }
    return {
      mode: this.mode,
      tranId,
      found: attempts.length > 0,
      attempts: attempts.map((a) => ({
        status: a.status,
        amount: a.amount,
        currency: a.currency,
        bankTranId: a.bank_tran_id,
        valId: a.val_id,
        cardType: a.card_type,
        date: a.tran_date,
        risk: a.risk_title,
      })),
    };
  }

  /** Asks SSLCommerz to refund a payment, identified by its bank transaction id. */
  async refund(input: RefundInput) {
    const reply = await this.query({
      bank_tran_id: input.bankTranId,
      refund_amount: toAmount(input.amount),
      refund_remarks: input.remarks,
      ...(input.referenceId ? { refe_id: input.referenceId } : {}),
    });
    if (reply.APIConnect !== "DONE" || reply.status === "failed") {
      throw new ProviderError("SSLCommerz", reply.errorReason || `refund failed (${reply.APIConnect})`, "refund_failed", reply);
    }
    return {
      mode: this.mode,
      status: reply.status,
      refundRefId: reply.refund_ref_id,
      bankTranId: reply.bank_tran_id ?? input.bankTranId,
    };
  }

  async getRefund(refundRefId: string) {
    const reply = await this.query({ refund_ref_id: refundRefId });
    if (reply.APIConnect !== "DONE") {
      throw new ProviderError("SSLCommerz", reply.errorReason || `lookup failed (${reply.APIConnect})`, "refund_query_failed", reply);
    }
    return {
      mode: this.mode,
      refundRefId,
      status: reply.status,
      initiatedOn: reply.initiated_on,
      refundedOn: reply.refunded_on,
    };
  }
}
