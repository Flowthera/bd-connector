# Add payments to any website

Three ways to take payments on a website, from no code to full control. All of them need a running BD Connector server ([setup guide](setup-guide.md)). In the examples, `https://pay.your-shop.com` stands for your `BD_CONNECTOR_PUBLIC_URL`.

| Way | Code needed | Good for |
|---|---|---|
| [Payment link](#1-payment-link) | None | Invoices, social media, WhatsApp and SMS sales |
| [Pay button](#2-pay-button) | Paste 2 lines | WordPress, Shopify, Wix, Blogger, any HTML page |
| [API and webhooks](#3-api-and-webhooks) | Back-end code | Online shops and apps that create orders |

The dashboard (`/dashboard`) and the [button and link maker](button-maker.html) build links and button code for you.

## 1. Payment link

```
https://pay.your-shop.com/pay?amount=1500&description=Invoice%2042&reference=INV-42&lock=1
```

Send it by SMS, WhatsApp, Facebook or email. The customer enters their name and mobile number, picks bKash, Nagad, card or another option, and pays. Every parameter is listed in the [setup guide](setup-guide.md#payment-links).

## 2. Pay button

Paste this where the button should appear:

```html
<script src="https://pay.your-shop.com/embed.js" defer></script>
<button data-bd-pay data-amount="1500" data-description="Invoice 42" data-reference="INV-42"></button>
```

It shows a **Pay ৳1,500** button. Clicking it opens your checkout page with the amount filled in and locked.

### Button options

| Attribute | Meaning |
|---|---|
| `data-bd-pay` | Required. Turns the element into a Pay button. Works on `<button>` and `<a>`. |
| `data-amount` | Amount in taka. Leave it out to let the customer type the amount (donations, custom payments). |
| `data-description` | What the payment is for. |
| `data-reference` | Your invoice or order number. Comes back in webhooks, the API and CSV exports. |
| `data-provider` | Pre-select a gateway: `bkash`, `nagad`, `sslcommerz`, `shurjopay` or `aamarpay`. |
| `data-name`, `data-phone`, `data-email` | Pre-fill the customer's details. |
| `data-lock="false"` | Let the customer change a given amount. |
| `data-target` | `new` opens checkout in a new tab, `popup` in a small window. Default: same tab. |
| `data-style="none"` | Keep your own styling instead of the green button. |

The button text is "Pay ৳amount" unless you write your own: `<button data-bd-pay data-amount="500">Buy the e-book</button>`.

### From JavaScript

The script also adds `window.BDPay`:

```js
BDPay.pay({ amount: 750, description: "Course fee", reference: "ORD-9" });   // go to checkout
BDPay.pay({ amount: 750 }, "new");                                          // in a new tab
const url = BDPay.link({ amount: 750, provider: "bkash" });                 // just the link
BDPay.scan();                                                               // set up buttons added later
```

Buttons added after the page loads (React, Vue, single-page apps) are found automatically.

### Where to paste it

| Platform | Where |
|---|---|
| WordPress | Edit the page, add a **Custom HTML** block, paste both lines. |
| Shopify | **Online Store → Themes → Customize**, add a **Custom Liquid** section, paste both lines. |
| Wix | **Add → Embed Code → Embed HTML**, paste both lines. |
| Blogger | **Layout → Add a Gadget → HTML/JavaScript**. |
| Plain HTML, Laravel, Django | Put the `<script>` once in your layout and the `<button>` wherever needed. |

### Knowing who paid

A button only starts the payment. To update your own system when someone pays, use one of:

- **The dashboard and SMS alerts:** fine for small businesses that check payments by hand.
- **The return redirect:** set `BD_CONNECTOR_RETURN_URL` to a page on your site; it receives `status`, `reference` and a signature. See [the return redirect](api.md#the-return-redirect).
- **Webhooks:** your server gets every result. See [webhooks](api.md#webhooks).
- **Google Sheets, CRM or accounting:** see [Accounts and CRM](accounts-and-crm.md).

## 3. API and webhooks

For online shops that create orders in their own database:

1. When the customer checks out, your server calls `POST /api/payments` with the amount, the customer and your order number as `reference`.
2. Redirect the customer to `paymentUrl`.
3. Your webhook receives `payment.success` with `reference`. Mark that order paid.

Full guide with PHP, Node.js and Python code: [API and webhooks](api.md). Every endpoint: [API reference](api-reference.html). Your own server shows the same reference at `https://pay.your-shop.com/docs`, where you can send test requests with your API key, and the machine-readable description at `/openapi.json` (import it into Postman, Insomnia or a code generator).

### PHP example

```php
<?php
// checkout.php: start a bKash payment for order 1001 and send the customer to pay
$ch = curl_init('https://pay.your-shop.com/api/payments');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_HTTPHEADER => [
        'Authorization: Bearer ' . getenv('BD_CONNECTOR_API_KEY'),
        'Content-Type: application/json',
    ],
    CURLOPT_POSTFIELDS => json_encode([
        'provider' => 'bkash',
        'amount' => 1250,
        'customer' => ['name' => $_POST['name'], 'phone' => $_POST['phone']],
        'reference' => 'ORDER-1001',
    ]),
]);
$payment = json_decode(curl_exec($ch), true);
header('Location: ' . $payment['paymentUrl']);
```

### Python example

```python
import os, requests

r = requests.post(
    "https://pay.your-shop.com/api/payments",
    headers={"Authorization": f"Bearer {os.environ['BD_CONNECTOR_API_KEY']}"},
    json={"provider": "nagad", "amount": 1250,
          "customer": {"name": "Rahim", "phone": "01712345678"},
          "reference": "ORDER-1001"},
)
r.raise_for_status()
redirect_to = r.json()["paymentUrl"]
```
