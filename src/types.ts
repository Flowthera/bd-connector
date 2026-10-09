export const PROVIDERS = ["bkash", "nagad", "sslcommerz", "shurjopay", "aamarpay"] as const;
export type Provider = (typeof PROVIDERS)[number];

export type PaymentStatus = "pending" | "success" | "failed" | "cancelled" | "refunded";

export interface Customer {
  name: string;
  phone: string;
  email?: string;
  address?: string;
  city?: string;
}

/** One payment, as stored and as sent in webhooks. Every field is documented in docs/data-reference.md. */
export interface Payment {
  orderId: string;
  reference: string | null;
  provider: Provider;
  mode: "sandbox" | "live";
  status: PaymentStatus;
  paid: boolean;
  amount: number;
  paidAmount: number | null;
  currency: "BDT";
  description: string;
  customer: Customer;
  transactionId: string | null;
  gatewayReference: string | null;
  /** Raw ids from the gateway that refunds and lookups need (paymentID, bank_tran_id and so on). */
  gateway: Record<string, string>;
  method: string | null;
  message: string | null;
  metadata: Record<string, string>;
  paymentUrl: string | null;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  refunds: Refund[];
  notifications: Notification[];
}

export interface Refund {
  amount: number;
  status: string;
  reference: string | null;
  createdAt: string;
}

export interface Notification {
  kind: "webhook" | "sms";
  to: string;
  event: string;
  ok: boolean;
  dryRun?: boolean;
  error?: string;
  at: string;
}

export type PaymentEvent = "payment.success" | "payment.failed" | "payment.cancelled" | "payment.refunded";

export interface CreatePaymentInput {
  provider: Provider;
  amount: number;
  customer: Customer;
  description?: string;
  /** Your own order or invoice number. Stored and returned; the connector makes its own orderId. */
  reference?: string;
  metadata?: Record<string, string>;
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  bkash: "bKash",
  nagad: "Nagad",
  sslcommerz: "Card, bank or mobile wallet (SSLCommerz)",
  shurjopay: "Rocket, Upay, bKash, Nagad or card (shurjoPay)",
  aamarpay: "Rocket, Upay, wallets or card (aamarPay)",
};
