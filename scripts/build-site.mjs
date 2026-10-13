// Builds the docs website into site/: every guide in docs/, the interactive API reference and the
// button maker. Run with: npm run docs:build
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import { openApiSpec } from "../dist/openapi.js";
import { VERSION } from "../dist/version.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "site");
const REPO = "https://github.com/Flowthera/bd-connector";

const PAGES = [
  { file: "README.md", slug: "index", title: "Overview" },
  { file: "docs/setup-guide.md", slug: "setup-guide", title: "Setup guide" },
  { file: "docs/website-integration.md", slug: "website-integration", title: "Add to any website" },
  { file: "docs/api.md", slug: "api", title: "API and webhooks" },
  { slug: "api-reference", title: "API reference" },
  { file: "docs/accounts-and-crm.md", slug: "accounts-and-crm", title: "Accounts and CRM" },
  { file: "docs/node-library.md", slug: "node-library", title: "Node.js library" },
  { file: "docs/claude.md", slug: "claude", title: "Claude and AI agents" },
  { file: "docs/gateways.md", slug: "gateways", title: "Gateways" },
  { file: "docs/configuration.md", slug: "configuration", title: "Configuration" },
  { file: "docs/data-reference.md", slug: "data-reference", title: "Payment data reference" },
  { slug: "button-maker", title: "Button and link maker" },
];

const CSS = `
:root{--bg:#fff;--side:#f6f7f9;--text:#16181d;--muted:#5c6370;--line:#e3e6eb;--accent:#0f766e;--code:#f3f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--side:#14171c;--text:#e8eaee;--muted:#9aa1ad;--line:#2a2f38;--accent:#2dd4bf;--code:#1b1f26}}
*{box-sizing:border-box}html{scroll-padding-top:16px}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
.layout{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
nav{background:var(--side);border-right:1px solid var(--line);padding:20px 14px;position:sticky;top:0;height:100vh;overflow:auto}
nav .brand{font-weight:700;font-size:17px;margin:0 8px 2px;display:block;color:var(--text);text-decoration:none}nav .ver{color:var(--muted);font-size:12px;margin:0 8px 16px}
nav a.page{display:block;padding:6px 10px;border-radius:6px;color:var(--text);text-decoration:none;font-size:15px}nav a.page:hover{background:var(--line)}nav a.page.on{background:var(--accent);color:#fff}
nav .ext{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}
main{padding:32px 40px 64px;max-width:900px;width:100%}
h1{font-size:30px;line-height:1.25;margin:0 0 16px}h2{font-size:22px;margin:36px 0 10px;padding-top:8px;border-top:1px solid var(--line)}h3{font-size:18px;margin:26px 0 8px}
a{color:var(--accent)}code{background:var(--code);padding:1px 5px;border-radius:4px;font:14px ui-monospace,Menlo,Consolas,monospace}
pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto;position:relative}pre code{background:none;padding:0;font-size:13.5px;line-height:1.55}
.copy{position:absolute;top:8px;right:8px;font:12px system-ui;border:1px solid var(--line);background:var(--bg);color:var(--text);border-radius:6px;padding:3px 8px;cursor:pointer;opacity:.8}
table{border-collapse:collapse;width:100%;font-size:14.5px;display:block;overflow-x:auto}th,td{border-bottom:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}th{background:var(--side)}
blockquote{margin:16px 0;padding:10px 16px;border-left:4px solid var(--accent);background:var(--side);border-radius:0 8px 8px 0}
.menu{display:none}
label{display:block;font-weight:600;font-size:14px;margin:14px 0 4px}input,select,textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
textarea{font:13px/1.5 ui-monospace,Menlo,monospace}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}.preview{margin:18px 0;padding:18px;border:1px dashed var(--line);border-radius:10px}
@media (max-width:820px){.layout{display:block}nav{position:static;height:auto;display:none}nav.open{display:block}.menu{display:block;padding:12px 16px;border-bottom:1px solid var(--line)}.menu button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--side);color:var(--text)}main{padding:20px 16px 48px}.row{grid-template-columns:1fr}}`;

const COPY_JS = `document.querySelectorAll("pre").forEach(function(pre){var b=document.createElement("button");b.className="copy";b.textContent="Copy";b.onclick=function(){navigator.clipboard.writeText(pre.innerText.replace(/Copy$/,"").trim());b.textContent="Copied";setTimeout(function(){b.textContent="Copy"},1500)};pre.appendChild(b)});`;

function nav(current) {
  return `<nav id="nav"><a class="brand" href="index.html">BD Connector</a><div class="ver">v${VERSION} · Flowthera</div>${PAGES.map(
    (p) => `<a class="page${p.slug === current ? " on" : ""}" href="${p.slug}.html">${p.title}</a>`,
  ).join("")}<div class="ext"><a class="page" href="${REPO}">GitHub</a><a class="page" href="https://bd.flowthera.com">Hosted version</a></div></nav>`;
}

function layout(page, body, head = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${page.title} · Flowthera BD Connector</title><meta name="description" content="Free, open-source payments and SMS for Bangladesh: bKash, Nagad, Rocket, Upay, cards. Docs and API reference.">
<style>${CSS}</style>${head}</head><body><div class="menu"><button onclick="document.getElementById('nav').classList.toggle('open')">Menu</button></div>
<div class="layout">${nav(page.slug)}<main>${body}</main></div><script>${COPY_JS}</script></body></html>`;
}

function rewriteLinks(html) {
  return html
    .replace(/href="(?:\.\.\/)?(?:docs\/)?([a-z-]+)\.md(#[^"]*)?"/g, (_, name, hash = "") => `href="${name === "README" ? "index" : name}.html${hash}"`)
    .replace(/href="(?:\.\.\/)?(examples\/[^"]*|\.env\.example|LICENSE)"/g, (_, path) => `href="${REPO}/blob/main/${path}"`);
}

const BUTTON_MAKER = `<h1>Button and link maker</h1>
<p>Make a payment link to share by SMS, WhatsApp or email, or a button to paste into any website. Payments go to your own BD Connector server.</p>
<label for="srv">Your server address (BD_CONNECTOR_PUBLIC_URL)</label><input id="srv" placeholder="https://pay.your-shop.com">
<div class="row"><div><label for="amount">Amount in taka (empty: the customer types it)</label><input id="amount" type="number" min="1" step="0.01" value="1500"></div>
<div><label for="provider">Gateway</label><select id="provider"><option value="">Customer chooses</option><option value="bkash">bKash</option><option value="nagad">Nagad</option><option value="sslcommerz">SSLCommerz (cards, wallets, banking)</option><option value="shurjopay">shurjoPay (Rocket, Upay, cards)</option><option value="aamarpay">aamarPay (Rocket, Upay, cards)</option></select></div></div>
<div class="row"><div><label for="description">What it's for</label><input id="description" value="Invoice 42"></div><div><label for="reference">Your invoice or order number</label><input id="reference" value="INV-42"></div></div>
<div class="row"><div><label for="label">Button text (empty: "Pay ৳amount")</label><input id="label"></div><div><label for="target">Open checkout</label><select id="target"><option value="">In the same tab</option><option value="new">In a new tab</option><option value="popup">In a popup</option></select></div></div>
<label for="link">Payment link</label><textarea id="link" rows="2" readonly></textarea>
<label for="code">Website button code</label><textarea id="code" rows="4" readonly></textarea>
<div class="preview"><div class="muted">Preview (enter your server address to try it):</div><p id="prev"></p></div>
<p>The button works on any website: WordPress (Custom HTML block), Shopify, Wix (Embed code), Blogger, Laravel or plain HTML. Details in <a href="website-integration.html">Add to any website</a>.</p>
<script>(function(){
  var ids=["srv","amount","provider","description","reference","label","target"];
  function v(id){return document.getElementById(id).value.trim()}
  function esc(s){return String(s).replace(/[&<>"]/g,function(c){return "&#"+c.charCodeAt(0)+";"})}
  function update(){
    var base=(v("srv")||"https://pay.your-shop.com").replace(/\\/+$/,""),q=new URLSearchParams(),attrs="";
    ["amount","description","reference","provider"].forEach(function(k){var x=v(k);if(x){q.set(k,x);attrs+=" data-"+k+'="'+esc(x)+'"'}});
    if(v("target"))attrs+=' data-target="'+esc(v("target"))+'"';
    if(q.get("amount"))q.set("lock","1");
    document.getElementById("link").value=base+"/pay"+(q.toString()?"?"+q:"");
    document.getElementById("code").value='<script src="'+base+'/embed.js" defer><\\/script>\\n<button data-bd-pay'+attrs+'>'+esc(v("label"))+'</button>';
    var a=v("amount");document.getElementById("prev").innerHTML='<a class="bd" style="display:inline-block;background:#0f766e;color:#fff;border-radius:8px;padding:11px 20px;font-weight:600;text-decoration:none" target="_blank" rel="noopener" href="'+esc(v("srv")?document.getElementById("link").value:"#")+'">'+esc(v("label")||(a?"Pay \\u09F3"+Number(a).toLocaleString("en-IN"):"Pay now"))+"</a>";
  }
  ids.forEach(function(id){document.getElementById(id).addEventListener("input",update)});update();
})();</script>`;

function apiReference() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>API reference · Flowthera BD Connector</title></head>
<body><div id="app"></div><script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.69.2"></script>
<script>Scalar.createApiReference("#app", { url: "openapi.json", metaData: { title: "BD Connector API reference" } });</script></body></html>`;
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const page of PAGES) {
  if (page.slug === "api-reference") {
    await writeFile(join(out, "api-reference.html"), apiReference());
  } else if (page.slug === "button-maker") {
    await writeFile(join(out, "button-maker.html"), layout(page, BUTTON_MAKER));
  } else {
    const md = await readFile(join(root, page.file), "utf8");
    await writeFile(join(out, `${page.slug}.html`), layout(page, rewriteLinks(await marked.parse(md))));
  }
}
await writeFile(join(out, "openapi.json"), JSON.stringify(openApiSpec(), null, 2));
await writeFile(join(out, ".nojekyll"), "");
console.log(`Docs site written to ${out} (${PAGES.length} pages)`);
