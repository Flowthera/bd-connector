import type { Payment } from "./types.js";

const COLUMNS: [string, (p: Payment) => unknown][] = [
  ["order_id", (p) => p.orderId],
  ["reference", (p) => p.reference],
  ["created_at", (p) => p.createdAt],
  ["paid_at", (p) => p.paidAt],
  ["status", (p) => p.status],
  ["provider", (p) => p.provider],
  ["method", (p) => p.method],
  ["amount", (p) => p.amount],
  ["paid_amount", (p) => p.paidAmount],
  ["refunded_amount", (p) => p.refunds.reduce((sum, r) => sum + r.amount, 0) || null],
  ["currency", (p) => p.currency],
  ["customer_name", (p) => p.customer.name],
  ["customer_phone", (p) => p.customer.phone],
  ["customer_email", (p) => p.customer.email],
  ["transaction_id", (p) => p.transactionId],
  ["description", (p) => p.description],
  ["mode", (p) => p.mode],
];

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Stop spreadsheet apps from running a customer-supplied value as a formula.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === "string") text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Payments as CSV, one row each, for Excel, Google Sheets and accounting software. */
export function paymentsToCsv(payments: Payment[]): string {
  const rows = [COLUMNS.map(([name]) => name).join(",")];
  for (const p of payments) rows.push(COLUMNS.map(([, get]) => cell(get(p))).join(","));
  // The byte-order mark makes Excel read Bangla text correctly.
  return "﻿" + rows.join("\r\n") + "\r\n";
}
