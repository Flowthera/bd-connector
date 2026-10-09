// A shop that takes payments with Flowthera BD Connector.
// Run from the repository root:  node --env-file=.env examples/express/server.mjs
// Needs: npm install express, and BD_CONNECTOR_PUBLIC_URL=https://<your public address>/payments
import express from "express";
import { BdConnector, createHandler } from "../../dist/lib.js"; // in your project: "@flowthera/bd-connector"

const bd = new BdConnector();
const orders = new Map(); // your real orders table

bd.on("payment.success", (payment) => {
  orders.set(payment.reference, { ...orders.get(payment.reference), status: "paid", trx: payment.transactionId });
  console.log(`Order ${payment.reference} paid: Tk ${payment.amount} by ${payment.customer.name} (${payment.transactionId})`);
});
bd.on("payment.failed", (payment) => console.log(`Order ${payment.reference} failed: ${payment.message}`));
bd.on("payment.cancelled", (payment) => console.log(`Order ${payment.reference} cancelled`));

const app = express();
app.use("/payments", createHandler(bd)); // before body parsers
app.use(express.urlencoded({ extended: false }));

app.get("/", (_req, res) => {
  const options = bd.providers().map((p) => `<option value="${p}">${p}</option>`).join("");
  res.send(`<h1>Demo shop</h1><form method="post" action="/buy">
    <p>Book: Tk 450</p>
    <p><input name="name" placeholder="Name" required> <input name="phone" placeholder="01XXXXXXXXX" required></p>
    <p><select name="method">${options}</select> <button>Buy</button></p></form>`);
});

app.post("/buy", async (req, res) => {
  const orderNumber = `ORD-${Date.now()}`;
  orders.set(orderNumber, { status: "waiting" });
  try {
    const payment = await bd.createPayment({
      provider: req.body.method,
      amount: 450,
      customer: { name: req.body.name, phone: req.body.phone },
      description: "Book",
      reference: orderNumber,
    });
    res.redirect(303, payment.paymentUrl);
  } catch (error) {
    res.status(400).send(`Could not start the payment: ${error.message}`);
  }
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Demo shop on http://localhost:${port}`));
process.on("SIGINT", async () => {
  await bd.flush();
  process.exit(0);
});
