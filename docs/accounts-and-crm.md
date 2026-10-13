# Accounts and CRM

Get every payment into your accounts, spreadsheets and customer records, with the amount, customer, method, transaction ID and your own order number.

| Need | Use |
|---|---|
| Monthly accounts, VAT records, your accountant | [CSV export](#csv-export) |
| A live sheet of payments | [Google Sheets](#google-sheets) |
| HubSpot, Zoho, Salesforce, Odoo, QuickBooks, Xero, Notion, Slack and thousands more | [Zapier, Make or n8n](#zapier-make-and-n8n) |
| Your own CRM or database | [Webhooks and API](api.md) |

## CSV export

In the dashboard, filter the list if you like and press **Download CSV**. The file opens in Excel, Google Sheets, LibreOffice and accounting software, with Bangla names shown correctly.

From the API, for automatic exports:

```bash
curl -H "Authorization: Bearer $BD_CONNECTOR_API_KEY" \
  "https://pay.your-shop.com/api/payments.csv?status=success&from=2026-10-01&to=2026-10-31" -o october.csv
```

| Filter | Meaning |
|---|---|
| `status` | `success`, `failed`, `cancelled`, `pending` or `refunded` |
| `provider` | `bkash`, `nagad`, `sslcommerz`, `shurjopay` or `aamarpay` |
| `from`, `to` | Dates as `YYYY-MM-DD`, by the Dhaka calendar day the payment was created |
| `search` | Order id, reference, name, phone, email or transaction ID |

Columns: `order_id`, `reference`, `created_at`, `paid_at`, `status`, `provider`, `method`, `amount`, `paid_amount`, `refunded_amount`, `currency`, `customer_name`, `customer_phone`, `customer_email`, `transaction_id`, `description`, `mode`. Times are UTC (ISO 8601). Each field is explained in the [data reference](data-reference.md).

## Google Sheets

Every payment result can land in a Google Sheet as a new row, with no other service in between.

1. Create a sheet with the headers `Date`, `Order`, `Reference`, `Status`, `Amount`, `Gateway`, `Method`, `Customer`, `Phone`, `Transaction ID` in row 1.
2. In the sheet, open **Extensions → Apps Script**, replace the code with the script below, and set `SECRET` to your `BD_CONNECTOR_WEBHOOK_SECRET`.
3. **Deploy → New deployment → Web app**, execute as **Me**, access **Anyone**. Copy the web app URL.
4. Set `BD_CONNECTOR_WEBHOOK_URL` to that URL and restart the connector.

```js
const SECRET = "your BD_CONNECTOR_WEBHOOK_SECRET";

function doPost(e) {
  if (e.parameter.token !== SECRET) return ContentService.createTextOutput("forbidden");
  const { payment: p } = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSpreadsheet().getSheets()[0].appendRow([
    new Date(p.updatedAt), p.orderId, p.reference || "", p.status, p.paidAmount ?? p.amount,
    p.provider, p.method || "", p.customer.name, "'" + p.customer.phone, p.transactionId || "",
  ]);
  return ContentService.createTextOutput("ok");
}
```

Google Apps Script can't read request headers, so it can't check `X-BD-Signature`. Put the secret in the URL instead: `BD_CONNECTOR_WEBHOOK_URL=https://script.google.com/macros/s/.../exec?token=<your secret>`. Keep that URL private. The connector never shows the part after `?` in payment records or the dashboard.

## Zapier, Make and n8n

These services connect a webhook to thousands of apps, including most CRMs (HubSpot, Zoho CRM, Salesforce, Pipedrive), accounting tools (QuickBooks, Xero, Zoho Books), Odoo, Notion, Airtable, Slack and email.

1. Create a new automation that starts with a webhook trigger:
   - Zapier: **Webhooks by Zapier → Catch Hook**
   - Make: **Webhooks → Custom webhook**
   - n8n: **Webhook** node, method POST
2. Copy the webhook address it gives you into `BD_CONNECTOR_WEBHOOK_URL` and restart the connector.
3. Make one test payment in sandbox mode so the automation sees a sample.
4. Add a filter on `event` equals `payment.success` (or keep all events), then map fields: `payment.amount`, `payment.customer.name`, `payment.customer.phone`, `payment.transactionId`, `payment.reference` and so on.

Example automations:

- **CRM:** find or create a contact by `payment.customer.phone`, then add a deal or invoice marked paid.
- **Accounting:** create a sales receipt for `payment.paidAmount` with `payment.reference` as the invoice number.
- **Team alert:** post "৳{amount} received from {name}" to Slack or WhatsApp.

Only one webhook address can be set. To feed several apps, point it at one automation and fan out from there.

## Your own CRM or database

Use [webhooks](api.md#webhooks) to receive each result as it happens, and the [API](api.md) to look payments up or sync them. Match payments to your records with `reference` (your order or invoice number) and keep `orderId` and `transactionId` for support and refunds.

## Hosted version

Don't want to run a server? The hosted version at [bd.flowthera.com](https://bd.flowthera.com) runs it for you.
