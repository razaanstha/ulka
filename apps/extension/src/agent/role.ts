// Shared browser-side role inference keeps observation and freshness consistent.
export const ROLE_HELPERS = String.raw`
  const actionableRole = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit === "textbox" && (element.getAttribute("aria-autocomplete") || element.getAttribute("aria-haspopup") === "listbox")) return "combobox";
    if (["button", "link", "checkbox", "radio", "tab", "menuitem", "option", "gridcell", "combobox", "textbox", "searchbox", "spinbutton"].includes(explicit)) return explicit;
    if (element.tagName === "BUTTON" || element.tagName === "SUMMARY") return "button";
    if (element.tagName === "A") return "link";
    if (element.tagName === "SELECT") return "combobox";
    if (element.tagName === "TEXTAREA" || element.isContentEditable) return "textbox";
    if (element.getAttribute("aria-autocomplete") || element.getAttribute("aria-haspopup") === "listbox") return "combobox";
    if (element.tagName === "INPUT" && element.type === "search") return "searchbox";
    if (element.tagName === "INPUT" && element.type === "number") return "spinbutton";
    if (element.tagName === "INPUT" && ["text", "email", "url", "tel", "date", "time", "month", "week"].includes(element.type)) return "textbox";
    if (element.tagName === "INPUT" && ["button", "submit", "reset", "image", "checkbox", "radio"].includes(element.type)) return element.type === "checkbox" || element.type === "radio" ? element.type : "button";
    return null;
  };
`;
