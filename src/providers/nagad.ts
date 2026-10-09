import { constants, createPrivateKey, createPublicKey, createSign, createVerify, privateDecrypt, publicEncrypt, randomBytes, type KeyObject } from "node:crypto";
import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, toAmount, type FetchFn } from "../http.js";

const ORIGINS: Record<Mode, string> = {
  sandbox: "http://sandbox.mynagad.com/remote-payment-gateway",
  live: "https://api.mynagad.com",
};

/** Nagad's numeric code for BDT. */
const BDT = "050";

/** Nagad requires a client IP header; a public placeholder is accepted for server-side calls. */
const PLACEHOLDER_IP = "103.100.200.100";

type Reply = Record<string, any>;

/** Accepts a PEM key or the bare base64 that Nagad's merchant portal shows. */
export function loadKey(key: string, kind: "PRIVATE" | "PUBLIC"): KeyObject {
  const trimmed = key.trim().replace(/\\n/g, "\n");
  const pem = trimmed.includes("-----BEGIN")
    ? trimmed
    : `-----BEGIN ${kind} KEY-----\n${(trimmed.replace(/\s+/g, "").match(/.{1,64}/g) ?? []).join("\n")}\n-----END ${kind} KEY-----\n`;
  try {
    return kind === "PRIVATE" ? createPrivateKey(pem) : createPublicKey(pem);
  } catch {
    throw new ProviderError("Nagad", `could not read the ${kind.toLowerCase()} key; expected PEM or base64 from the merchant portal`, "bad_key");
  }
}

/**
 * Decrypts RSA PKCS#1 v1.5, which Nagad uses for every reply. Node 20 refuses this padding in
 * privateDecrypt (CVE-2023-46809), so decrypt the raw block and remove the padding here.
 */
export function pkcs1Decrypt(key: KeyObject, ciphertext: Buffer): Buffer {
  const block = privateDecrypt({ key, padding: constants.RSA_NO_PADDING }, ciphertext);
  const separator = block.indexOf(0, 2);
  if (block[0] !== 0 || block[1] !== 2 || separator < 10) throw new Error("bad padding");
  return block.subarray(separator + 1);
}

/** Nagad timestamps are yyyyMMddHHmmss in Dhaka time. */
export function dhakaTimestamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}${hour}${get("minute")}${get("second")}`;
}

export interface CreatePaymentInput {
  amount: number;
  orderId: string;
  callbackUrl?: string;
}

export class Nagad {
  private readonly origin: string;
  private readonly privateKey: KeyObject;
  private readonly nagadKey: KeyObject;

  constructor(
    private readonly config: NonNullable<Config["nagad"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    this.origin = ORIGINS[mode];
    this.privateKey = loadKey(config.merchantPrivateKey, "PRIVATE");
    this.nagadKey = loadKey(config.nagadPublicKey, "PUBLIC");
  }

  private encrypt(value: unknown): string {
    return publicEncrypt({ key: this.nagadKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(JSON.stringify(value))).toString("base64");
  }

  private sign(value: unknown): string {
    return createSign("SHA256").update(JSON.stringify(value)).sign(this.privateKey, "base64");
  }

  private decrypt(reply: Reply, step: string): Reply {
    if (!reply.sensitiveData) {
      throw new ProviderError("Nagad", `${step}: ${reply.message ?? reply.reason ?? "request was rejected"}`, reply.reason ?? "rejected", reply);
    }
    let plaintext: string;
    try {
      plaintext = pkcs1Decrypt(this.privateKey, Buffer.from(reply.sensitiveData, "base64")).toString("utf8");
    } catch {
      throw new ProviderError("Nagad", `${step}: could not read the reply; the merchant private key probably doesn't match the one registered with Nagad`, "key_mismatch");
    }
    if (reply.signature && !createVerify("SHA256").update(plaintext).verify(this.nagadKey, Buffer.from(reply.signature, "base64"))) {
      throw new ProviderError("Nagad", `${step}: the reply's signature did not verify`, "bad_signature");
    }
    return JSON.parse(plaintext);
  }

  private headers() {
    return { "X-KM-Api-Version": "v-0.2.0", "X-KM-IP-V4": PLACEHOLDER_IP, "X-KM-Client-Type": "PC_WEB" };
  }

  /** Runs Nagad's two-step checkout (initialize, then complete) and returns the payment page URL. */
  async createPayment(input: CreatePaymentInput) {
    const callbackUrl = input.callbackUrl ?? this.config.callbackUrl;
    if (!callbackUrl) {
      throw new ProviderError("Nagad", "a callback URL is required: pass callback_url or set NAGAD_CALLBACK_URL", "missing_callback");
    }
    if (!/^[A-Za-z0-9]{1,20}$/.test(input.orderId)) {
      throw new ProviderError("Nagad", "order_id must be 1-20 letters or digits", "invalid_order_id");
    }
    const fixed = toAmount(input.amount);
    const amount = fixed.endsWith(".00") ? fixed.slice(0, -3) : fixed;
    const dateTime = dhakaTimestamp();
    const merchantId = this.config.merchantId;

    // Nagad spells it "datetime" inside the encrypted part and "dateTime" outside.
    const initSensitive = { merchantId, datetime: dateTime, orderId: input.orderId, challenge: randomBytes(20).toString("hex").toUpperCase() };
    const initReply = await requestJson<Reply>(
      this.fetchFn,
      "Nagad",
      `${this.origin}/api/dfs/check-out/initialize/${encodeURIComponent(merchantId)}/${encodeURIComponent(input.orderId)}`,
      {
        headers: this.headers(),
        json: { accountNumber: this.config.merchantNumber, dateTime, sensitiveData: this.encrypt(initSensitive), signature: this.sign(initSensitive) },
        timeoutMs: this.timeoutMs,
      },
    );
    const init = this.decrypt(initReply, "initialize");
    if (!init.paymentReferenceId || !init.challenge) {
      throw new ProviderError("Nagad", "initialize: reply was missing the payment reference", "bad_response");
    }

    const completeSensitive = { merchantId, orderId: input.orderId, amount, currencyCode: BDT, challenge: init.challenge };
    const complete = await requestJson<Reply>(
      this.fetchFn,
      "Nagad",
      `${this.origin}/api/dfs/check-out/complete/${encodeURIComponent(init.paymentReferenceId)}`,
      {
        headers: this.headers(),
        json: {
          paymentRefId: init.paymentReferenceId,
          sensitiveData: this.encrypt(completeSensitive),
          signature: this.sign(completeSensitive),
          merchantCallbackURL: callbackUrl,
        },
        timeoutMs: this.timeoutMs,
      },
    );
    if (!complete.callBackUrl) {
      throw new ProviderError("Nagad", `complete: ${complete.message ?? complete.reason ?? complete.status ?? "no payment URL returned"}`, "complete_failed", complete);
    }
    return {
      mode: this.mode,
      paymentRefId: init.paymentReferenceId,
      orderId: input.orderId,
      amount,
      paymentUrl: complete.callBackUrl,
      nextStep: "Send the customer to paymentUrl, then confirm with nagad_get_payment and this paymentRefId.",
    };
  }

  /** Asks Nagad for the authoritative status of a payment. */
  async getPayment(paymentRefId: string) {
    const reply = await requestJson<Reply>(
      this.fetchFn,
      "Nagad",
      `${this.origin}/api/dfs/verify/payment/${encodeURIComponent(paymentRefId)}`,
      { method: "GET", headers: this.headers(), timeoutMs: this.timeoutMs },
    );
    if (!reply.status) {
      throw new ProviderError("Nagad", reply.message ?? reply.reason ?? "verification failed", reply.reason ?? "verify_failed", reply);
    }
    return {
      mode: this.mode,
      paymentRefId: reply.paymentRefId ?? paymentRefId,
      orderId: reply.orderId ?? null,
      status: reply.status,
      paid: String(reply.status).toLowerCase() === "success",
      amount: reply.amount ?? null,
      transactionId: reply.issuerPaymentRefNo ?? null,
      customer: reply.clientMobileNo ?? null,
      paidAt: reply.issuerPaymentDateTime ?? null,
    };
  }
}
