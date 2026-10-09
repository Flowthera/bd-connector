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
  bulksmsbd?: {
    apiKey: string;
    senderId?: string;
  };
}

type Env = Record<string, string | undefined>;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadConfig(env: Env = process.env): Config {
  const mode: Mode = env.BD_CONNECTOR_MODE?.trim().toLowerCase() === "live" ? "live" : "sandbox";
  const config: Config = { mode, timeoutMs: Number(env.BD_CONNECTOR_TIMEOUT_MS) || 30_000 };

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

  const smsKey = nonEmpty(env.BULKSMSBD_API_KEY);
  if (smsKey) {
    config.bulksmsbd = { apiKey: smsKey, senderId: nonEmpty(env.BULKSMSBD_SENDER_ID) };
  }

  return config;
}
