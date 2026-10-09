# Gateways

What each gateway offers, where to get keys, and how to test. Every gateway needs a business (trade license, bank account) for live keys; most give sandbox keys quickly.

| Gateway | Customers pay with | Sandbox keys | Live keys | Refunds in the connector |
|---|---|---|---|---|
| [bKash](#bkash) | bKash | bKash developer portal or merchant contact | bKash merchant (PGW) agreement | Yes |
| [Nagad](#nagad) | Nagad | Nagad merchant team | Nagad merchant agreement | No |
| [SSLCommerz](#sslcommerz) | Cards, bKash, Nagad, Rocket, Upay, net banking | Free, self-serve | SSLCommerz merchant agreement | Yes |
| [shurjoPay](#shurjopay) | bKash, Nagad, Rocket, Upay, cards, net banking | Public test account | shurjoPay merchant agreement | No |
| [aamarPay](#aamarpay) | bKash, Nagad, Rocket, Upay, cards | aamarPay developer docs | aamarPay merchant agreement | No |

**Which one to start with?** For one gateway that covers most customers, pick SSLCommerz, shurjoPay or aamarPay. Add bKash or Nagad directly if you want their own checkout and lower fees on those wallets. You can turn on as many as you like; customers choose on the checkout page.

**Rocket and Upay** don't offer an open merchant API of their own, so the connector reaches them through SSLCommerz, shurjoPay and aamarPay.

## bKash

- **Variables:** `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD`
- **API:** Tokenized Checkout v1.2.0-beta. Sandbox `tokenized.sandbox.bka.sh`, live `tokenized.pay.bka.sh`.
- **Sandbox keys:** from the bKash developer portal ([developer.bka.sh](https://developer.bka.sh)) or your bKash merchant contact.
- **Live keys:** apply for the bKash payment gateway as a merchant. bKash reviews your site and gives you live keys.
- **Flow:** the customer approves on bKash's page; when they come back, the connector completes ("executes") the payment and checks the result.

## Nagad

- **Variables:** `NAGAD_MERCHANT_ID`, `NAGAD_MERCHANT_NUMBER`, `NAGAD_MERCHANT_PRIVATE_KEY`, `NAGAD_PUBLIC_KEY`
- **API:** Nagad remote payment gateway, with RSA encryption and signing. Sandbox `sandbox.mynagad.com`, live `api.mynagad.com`.
- **Keys:** Nagad's merchant team gives you a merchant ID and Nagad's public key. You create your own key pair and register the public half with them:

  ```bash
  openssl genrsa -out nagad-private.pem 2048
  openssl rsa -in nagad-private.pem -pubout -out nagad-public.pem   # send this one to Nagad
  ```

  Paste keys as PEM (with `\n` for line breaks) or as the bare base64 text.
- **Refunds:** not in the connector yet; use the Nagad merchant panel.

## SSLCommerz

- **Variables:** `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`
- **API:** v4. Sandbox `sandbox.sslcommerz.com`, live `securepay.sslcommerz.com`.
- **Sandbox keys:** register at [developer.sslcommerz.com/registration](https://developer.sslcommerz.com/registration/). The store id and password arrive by email within minutes.
- **Live keys:** sign up as a merchant at [sslcommerz.com](https://sslcommerz.com).
- **Minimum amount:** ৳10.

## shurjoPay

- **Variables:** `SHURJOPAY_USERNAME`, `SHURJOPAY_PASSWORD`, `SHURJOPAY_PREFIX`
- **API:** shurjoPay v2. Sandbox `sandbox.shurjopayment.com`, live `engine.shurjopayment.com`.
- **Sandbox keys:** shurjoPay's official integration packages list a public test account (`sp_sandbox`, with its password and the prefix `SP`). See the [shurjoPay developer docs](https://shurjopay.com.bd/developer).
- **Live keys:** sign up as a merchant at [shurjopay.com.bd](https://shurjopay.com.bd). You get a user name, password and your own prefix.
- **Refunds:** use the shurjoPay merchant panel.

## aamarPay

- **Variables:** `AAMARPAY_STORE_ID`, `AAMARPAY_SIGNATURE_KEY`
- **API:** JSON checkout and transaction check. Sandbox `sandbox.aamarpay.com`, live `secure.aamarpay.com`.
- **Sandbox keys:** aamarPay's developer docs ([aamarpay.com](https://aamarpay.com)) publish a test store id (`aamarpaytest`) and signature key, or you can ask aamarPay for your own.
- **Live keys:** sign up as a merchant with aamarPay.
- **Refunds:** use the aamarPay merchant panel.

## BulkSMSBD (SMS)

- **Variables:** `BULKSMSBD_API_KEY`, `BULKSMSBD_SENDER_ID`
- **Keys:** create an account at [bulksmsbd.net](https://bulksmsbd.net), add balance, and get an API key and sender ID. Some accounts must whitelist your server's IP address.
- **Sandbox mode:** nothing is sent and no balance is used. Messages are recorded as `dryRun`.

## Testing

Test numbers, PINs and cards are published by each gateway and can change. Values commonly used in the sandboxes at the time of writing:

| Gateway | How to pay in the sandbox |
|---|---|
| bKash | Any sandbox wallet number from bKash's docs, OTP `123456`, PIN `12121` |
| SSLCommerz | The test cards and wallets listed on the SSLCommerz sandbox payment page (for example VISA `4111 1111 1111 1111`) |
| shurjoPay, aamarPay | Pick any method on the test page and follow its instructions |
| Nagad | Use the test wallet Nagad's merchant team gives you |

Check for each test payment that:

1. Success shows as `success` with a transaction ID, the customer sees a receipt, and your webhook gets `payment.success`.
2. Cancelling on the gateway page shows as `cancelled`.
3. A failed payment (for example a wrong PIN until it's declined) shows as `failed`.
