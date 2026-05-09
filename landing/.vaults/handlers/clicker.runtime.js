// Click-counter runtime. Event-delegated, so a single listener handles
// every clicker on the page (and in Foundry, every clicker across every
// open journal sheet). Wrapped in an IIFE to keep state out of the global
// scope. Idempotent against duplicate loads — multiple calls just attach
// multiple listeners, but the data-count update is still single-source.

(function () {
  if (window.__vaultsClickerLoaded) return;
  window.__vaultsClickerLoaded = true;
  document.addEventListener("click", function (e) {
    var btn = e.target instanceof HTMLElement ? e.target.closest("button.vaults-clicker") : null;
    if (!btn) return;
    var count = (parseInt(btn.dataset.count, 10) || 0) + 1;
    btn.dataset.count = String(count);
    var span = btn.querySelector(".vaults-clicker-count");
    if (span) span.textContent = String(count);
  });
})();
