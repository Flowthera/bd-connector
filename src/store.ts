import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Payment, PaymentStatus } from "./types.js";

export interface ListOptions {
  status?: PaymentStatus;
  provider?: string;
  search?: string;
  limit?: number;
}

/** Where payment records live. Use your own (a database) by implementing these three methods. */
export interface PaymentStore {
  get(orderId: string): Promise<Payment | undefined>;
  put(payment: Payment): Promise<void>;
  list(options?: ListOptions): Promise<Payment[]>;
}

export function filterPayments(all: Payment[], options: ListOptions = {}): Payment[] {
  const q = options.search?.trim().toLowerCase();
  return all
    .filter((p) => !options.status || p.status === options.status)
    .filter((p) => !options.provider || p.provider === options.provider)
    .filter(
      (p) =>
        !q ||
        [p.orderId, p.reference, p.customer.name, p.customer.phone, p.customer.email, p.transactionId]
          .some((v) => v?.toLowerCase().includes(q)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, options.limit ?? 500);
}

export class MemoryStore implements PaymentStore {
  private readonly payments = new Map<string, Payment>();
  async get(orderId: string) {
    const p = this.payments.get(orderId);
    return p && structuredClone(p);
  }
  async put(payment: Payment) {
    this.payments.set(payment.orderId, structuredClone(payment));
  }
  async list(options?: ListOptions) {
    return filterPayments([...this.payments.values()].map((p) => structuredClone(p)), options);
  }
}

/** Keeps payments in one JSON file (payments.json). No database needed; fine for thousands of payments. */
export class FileStore implements PaymentStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly dir: string) {
    this.file = join(dir, "payments.json");
  }

  private async read(): Promise<Record<string, Payment>> {
    try {
      const data = JSON.parse(await readFile(this.file, "utf8"));
      return data.payments ?? {};
    } catch (error: any) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }

  async get(orderId: string) {
    return (await this.read())[orderId];
  }

  put(payment: Payment): Promise<void> {
    const next = this.queue.then(async () => {
      const payments = await this.read();
      payments[payment.orderId] = payment;
      await mkdir(this.dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ payments }, null, 2));
      await rename(tmp, this.file);
    });
    this.queue = next.catch(() => undefined);
    return next;
  }

  async list(options?: ListOptions) {
    return filterPayments(Object.values(await this.read()), options);
  }
}
