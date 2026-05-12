// Demo handler: a click-counter widget. Inline form `clicker: label`
// renders a styled button with that label and a count. The runtime attaches
// one event-delegated listener that increments the data-count attribute on
// click. CSS gives it the canonical .vaults treatment.
//
// Both `assets.targets.foundry.{styles,scripts}` opt into Foundry import.
// When the GM has the matching toggles enabled in the per-vault settings
// dialog, this widget renders + functions inside Foundry journals too.
// Default off on both sides; the opt-in just makes it possible.

export const handler = {
  inline: "clicker",
  assets: {
    scripts: ["./clicker.runtime.js"],
    styles: ["./clicker.css"],
    foundry: { scripts: true, styles: true },
  },
  render(content, ctx) {
    const label = (content || "Click me").trim();
    return {
      html: `<button type="button" class="vaults-clicker" data-count="0"`
        + ` data-label="${ctx.escape(label)}">`
        + `${ctx.escape(label)} <span class="vaults-clicker-count">0</span>`
        + `</button>`,
    };
  },
};
