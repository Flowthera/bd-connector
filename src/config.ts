import { homedir } from "node:os";
import { join } from "node:path";

export type Mode = "sandbox" | "live";

export interface Config {
  mode: Mode;
  timeoutMs: number;
  bkash?: {
    appKey: string;
    appSecret: string;
    username: string;
    password: string;
    callbackUrl?: string;
  };
  sslcommerz?: {
    storeId: string;
    storePassword: string;
    successUrl?: string;
    failUrl?: string;
    cancelUrl?: string;
  };
  nagad?: {
    merchantId: string;
    merchantNumber: string;
    merchantPrivateKey: string;
    nagadPublicKey: string;
    callbackUrl?: string;
  };
  shurjopay?: {
    username: string;
    password: string;
    prefix: string;
    returnUrl?: string;
  };
  aamarpay?: {
    storeId: string;
    signatureKey: string;
    successUrl?: string;
    failUrl?: string;
    cancelUrl?: string;
  };
  bulksmsbd?: {
    apiKey: string;
    senderId?: string;
  };
  system: SystemConfig;
}

/** Settings for the payment system: callbacks, records, webhooks, SMS alerts and the dashboard. */
export interface SystemConfig {
  /** Public base URL where gateways send customers back, e.g. https://pay.example.com */
  publicUrl?: string;
  port: number;
  /** Folder for the payment records file. */
  dataDir: string;
  businessName: string;
  /** Where to send customers after a payment. Without it they see the built-in receipt page. */
  returnUrl?: string;
  webhookUrl?: string;
  webhookSecret?: string;
  /** Bearer key for the JSON API. The API is off without it. */
  apiKey?: string;
  /** Password for the dashboard. The dashboard is off without it. */
  dashboardPassword?: string;
  /** Whether the public checkout page at /pay is on. */
  checkoutPage: boolean;
  smsNotifyCustomer: boolean;
  smsOwnerNumbers: string[];
  smsTemplates: {
    customerSuccess: string;
    ownerSuccess: string;
    ownerFailed: string;
  };
}

export const DEFAULT_SMS_TEMPLATES = {
  customerSuccess: "{business}: payment of Tk {amount} received for order {orderId}. Trx ID {transactionId}. Thank you!",
  ownerSuccess: "Paid: Tk {amount} by {customerName} {customerPhone} via {provider}. Order {orderId}, Trx {transactionId}.",
  ownerFailed: "Payment {status}: Tk {amount} by {customerName} {customerPhone} via {provider}. Order {orderId}.",
};

type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: Env = process.env): Config {
  const mode: Mode = env.BD_CONNECTOR_MODE?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  const config: Config = { mode, timeoutMs: Number(env.BD_CONNECTOR_TIMEOUT_MS) || 30_000, system: loadSystem(env) };

  const appKey = nonEmpty(env.BKASH_APP_KEY);
  const appSecret = nonEmpty(env.BKASH_APP_SECRET);
  const username = nonEmpty(env.BKASH_USERNAME);
  const password = nonEmpty(env.BKASH_PASSWORD);
  if (appKey && appSecret && username && password) {
    config.bkash = { appKey, appSecret, username, password, callbackUrl: nonEmpty(env.BKASH_CALLBACK_URL) };
  }

  const storeId = nonEmpty(env.SSLCOMMERZ_STORE_ID);
  const storePassword = nonEmpty(env.SSLCOMMERZ_STORE_PASSWORD);
  if (storeId && storePassword) {
    config.sslcommerz = {
      storeId,
      storePassword,
      successUrl: nonEmpty(env.SSLCOMMERZ_SUCCESS_URL),
      failUrl: nonEmpty(env.SSLCOMMERZ_FAIL_URL),
      cancelUrl: nonEmpty(env.SSLCOMMERZ_CANCEL_URL),
    };
  }

  const nagadId = nonEmpty(env.NAGAD_MERCHANT_ID);
  const nagadNumber = nonEmpty(env.NAGAD_MERCHANT_NUMBER);
  const nagadPrivate = nonEmpty(env.NAGAD_MERCHANT_PRIVATE_KEY);
  const nagadPublic = nonEmpty(env.NAGAD_PUBLIC_KEY);
  if (nagadId && nagadNumber && nagadPrivate && nagadPublic) {
    config.nagad = {
      merchantId: nagadId,
      merchantNumber: nagadNumber,
      merchantPrivateKey: nagadPrivate,
      nagadPublicKey: nagadPublic,
      callbackUrl: nonEmpty(env.NAGAD_CALLBACK_URL),
    };
  }

  const spUser = nonEmpty(env.SHURJOPAY_USERNAME);
  const spPassword = nonEmpty(env.SHURJOPAY_PASSWORD);
  if (spUser && spPassword) {
    config.shurjopay = {
      username: spUser,
      password: spPassword,
      prefix: nonEmpty(env.SHURJOPAY_PREFIX) ?? "SP",
      returnUrl: nonEmpty(env.SHURJOPAY_RETURN_URL),
    };
  }

  const apStore = nonEmpty(env.AAMARPAY_STORE_ID);
  const apKey = nonEmpty(env.AAMARPAY_SIGNATURE_KEY);
  if (apStore && apKey) {
    config.aamarpay = {
      storeId: apStore,
      signatureKey: apKey,
      successUrl: nonEmpty(env.AAMARPAY_SUCCESS_URL),
      failUrl: nonEmpty(env.AAMARPAY_FAIL_URL),
      cancelUrl: nonEmpty(env.AAMARPAY_CANCEL_URL),
    };
  }

  const smsKey = nonEmpty(env.BULKSMSBD_API_KEY);
  if (smsKey) {
    config.bulksmsbd = { apiKey: smsKey, senderId: nonEmpty(env.BULKSMSBD_SENDER_ID) };
  }

  return config;
}

function flag(value: string | undefined, fallback: boolean): boolean {
  const v = value?.trim().toLowerCase();
  if (!v) return fallback;
  return !["0", "false", "no", "off"].includes(v);
}

function loadSystem(env: Env): SystemConfig {
  const publicUrl = nonEmpty(env.BD_CONNECTOR_PUBLIC_URL)?.replace(/\/+$/, "");
  return {
    publicUrl,
    port: Number(env.BD_CONNECTOR_PORT ?? env.PORT) || 8080,
    dataDir: nonEmpty(env.BD_CONNECTOR_DATA_DIR) ?? join(homedir(), ".bd-connector"),
    businessName: nonEmpty(env.BD_CONNECTOR_BUSINESS_NAME) ?? "Our shop",
    returnUrl: nonEmpty(env.BD_CONNECTOR_RETURN_URL),
    webhookUrl: nonEmpty(env.BD_CONNECTOR_WEBHOOK_URL),
    webhookSecret: nonEmpty(env.BD_CONNECTOR_WEBHOOK_SECRET),
    apiKey: nonEmpty(env.BD_CONNECTOR_API_KEY),
    dashboardPassword: nonEmpty(env.BD_CONNECTOR_DASHBOARD_PASSWORD),
    checkoutPage: flag(env.BD_CONNECTOR_CHECKOUT_PAGE, true),
    smsNotifyCustomer: flag(env.SMS_NOTIFY_CUSTOMER, true),
    smsOwnerNumbers: (env.SMS_OWNER_NUMBERS ?? "").split(",").map((n) => n.trim()).filter(Boolean),
    smsTemplates: {
      customerSuccess: nonEmpty(env.SMS_TEMPLATE_CUSTOMER_SUCCESS) ?? DEFAULT_SMS_TEMPLATES.customerSuccess,
      ownerSuccess: nonEmpty(env.SMS_TEMPLATE_OWNER_SUCCESS) ?? DEFAULT_SMS_TEMPLATES.ownerSuccess,
      ownerFailed: nonEmpty(env.SMS_TEMPLATE_OWNER_FAILED) ?? DEFAULT_SMS_TEMPLATES.ownerFailed,
    },
  };
}

/** Reads KEY=value lines from a .env file into an object. Existing environment values win. */
export function parseEnvFile(text: string): Env {
  const out: Env = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}
