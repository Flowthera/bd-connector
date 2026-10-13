/**
 * The script behind the one-line Pay button. Any website adds:
 *   <script src="https://pay.your-shop.com/embed.js" defer></script>
 *   <button data-bd-pay data-amount="1500" data-description="Invoice 42"></button>
 * Clicking opens the connector's checkout page. No back end is needed on that website.
 */
export const EMBED_JS = `(function () {
  "use strict";
  var script = document.currentScript;
  var base = script ? script.src.replace(/\\/embed\\.js(?:[?#].*)?$/, "") : "";
  var FIELDS = ["amount", "description", "reference", "provider", "name", "phone", "email"];
  var CSS = ".bd-pay-button{display:inline-flex;align-items:center;gap:8px;background:#0f766e;color:#fff;border:0;border-radius:8px;padding:11px 20px;font:600 15px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;cursor:pointer;text-decoration:none}" +
    ".bd-pay-button:hover{background:#115e59}.bd-pay-button:focus-visible{outline:3px solid #5eead4;outline-offset:2px}";

  function addStyle() {
    if (document.getElementById("bd-pay-style")) return;
    var style = document.createElement("style");
    style.id = "bd-pay-style";
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function link(options) {
    options = options || {};
    var query = new URLSearchParams();
    FIELDS.forEach(function (key) {
      if (options[key] !== undefined && options[key] !== null && options[key] !== "") query.set(key, String(options[key]));
    });
    if (options.amount && options.lock !== false && options.lock !== "false") query.set("lock", "1");
    return base + "/pay" + (query.toString() ? "?" + query : "");
  }

  function go(url, target) {
    if (target === "popup" && window.open(url, "bdpay", "width=480,height=780")) return;
    if (target === "new") { window.open(url, "_blank", "noopener"); return; }
    window.location.href = url;
  }

  function optionsOf(el) {
    var options = {};
    FIELDS.concat(["lock"]).forEach(function (key) { if (el.dataset[key] !== undefined) options[key] = el.dataset[key]; });
    return options;
  }

  function setup(el) {
    if (el.getAttribute("data-bd-ready")) return;
    el.setAttribute("data-bd-ready", "1");
    if (el.dataset.style !== "none") { addStyle(); el.classList.add("bd-pay-button"); }
    if (!el.textContent.trim()) {
      el.textContent = el.dataset.amount ? "Pay \\u09F3" + Number(el.dataset.amount).toLocaleString("en-IN") : "Pay now";
    }
    if (el.tagName === "A") el.setAttribute("href", link(optionsOf(el)));
    el.addEventListener("click", function (event) {
      event.preventDefault();
      go(link(optionsOf(el)), el.dataset.target);
    });
  }

  function scan() {
    var nodes = document.querySelectorAll("[data-bd-pay]");
    for (var i = 0; i < nodes.length; i++) setup(nodes[i]);
  }

  window.BDPay = {
    /** The checkout URL for these options: amount, description, reference, provider, name, phone, email, lock. */
    link: link,
    /** Sends the customer to checkout. target: "same" (default), "new" or "popup". */
    pay: function (options, target) { go(link(options), target); },
    /** Finds new [data-bd-pay] elements, for pages that add buttons later. */
    scan: scan,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
  if (window.MutationObserver) {
    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  }
})();
`;
