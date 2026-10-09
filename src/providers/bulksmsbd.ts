import type { Config, Mode } from "../config.js";
import { ProviderError, requestJson, type FetchFn } from "../http.js";

const BASE = "https://bulksmsbd.net/api";

const ERRORS: Record<string, string> = {
  "1001": "invalid number",
  "1002": "sender ID is incorrect or disabled",
  "1003": "required fields are missing",
  "1005": "internal error at the gateway",
  "1006": "balance validity not available",
  "1007": "insufficient balance",
  "1011": "user ID not found",
  "1012": "masking SMS must be in Bangla",
  "1013": "sender ID not found for this API key",
  "1018": "the account is disabled",
  "1031": "account not verified",
  "1032": "this IP address is not whitelisted",
};

/** Normalizes a Bangladeshi mobile number to 8801XXXXXXXXX. */
export function normalizeNumber(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  const local = digits.startsWith("88") ? digits.slice(2) : digits;
  if (!/^01[3-9]\d{8}$/.test(local)) {
    throw new ProviderError("SMS", `"${raw}" is not a valid Bangladeshi mobile number`, "invalid_number");
  }
  return `88${local}`;
}

export class BulkSmsBd {
  constructor(
    private readonly config: NonNullable<Config["bulksmsbd"]>,
    private readonly mode: Mode,
    private readonly timeoutMs: number,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  /** Sends one message to one or more numbers. In sandbox mode nothing is sent; the result shows what would go out. */
  async send(numbers: string[], message: string) {
    const recipients = numbers.map(normalizeNumber);
    if (!message.trim()) throw new ProviderError("SMS", "message is empty", "empty_message");
    if (this.mode === "sandbox") {
      return {
        mode: this.mode,
        sent: false,
        dryRun: true,
        recipients,
        message,
        note: "Sandbox mode: nothing was sent and no balance was used. Set BD_CONNECTOR_MODE=live to send real SMS.",
      };
    }
    if (!this.config.senderId) {
      throw new ProviderError("SMS", "set BULKSMSBD_SENDER_ID to send messages", "missing_sender_id");
    }
    const reply = await requestJson<Record<string, any>>(this.fetchFn, "SMS", `${BASE}/smsapi`, {
      form: { api_key: this.config.apiKey, senderid: this.config.senderId, number: recipients.join(","), message },
      timeoutMs: this.timeoutMs,
    });
    const code = String(reply.response_code ?? "");
    if (code !== "202") {
      const reason = reply.error_message || ERRORS[code] || "message was not accepted";
      throw new ProviderError("SMS", `${reason} (code ${code || "unknown"})`, code, reply);
    }
    return { mode: this.mode, sent: true, recipients, gatewayMessage: reply.success_message };
  }

  /** Reads the account balance. Safe in both modes; it moves no money. */
  async balance() {
    const reply = await requestJson<Record<string, any>>(this.fetchFn, "SMS", `${BASE}/getBalanceApi`, {
      form: { api_key: this.config.apiKey },
      timeoutMs: this.timeoutMs,
    });
    if (reply.balance === undefined) {
      const code = String(reply.response_code ?? "");
      throw new ProviderError("SMS", reply.error_message || ERRORS[code] || "could not read the balance", code, reply);
    }
    return { balance: Number(reply.balance), currency: "BDT" };
  }
}
