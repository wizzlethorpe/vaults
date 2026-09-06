// Demo handler: a click-counter widget. Inline form `clicker: label`
// renders a styled button with that label and a count. The runtime attaches
// one event-delegated listener that increments the data-count attribute on
// click. The CSS and script ship to the wiki only.

export const handler = {
  inline: "clicker",
  assets: {
    scripts: ["./clicker.runtime.js"],
    styles: ["./clicker.css"],
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
