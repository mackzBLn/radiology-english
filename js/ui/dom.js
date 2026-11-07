/*
 * Kleine Helfer für das DOM. Texte kommen immer als Textknoten in die Seite, nie als HTML.
 * Quellen:
 *   https://developer.mozilla.org/en-US/docs/Web/API/Document/createElement
 *   https://developer.mozilla.org/en-US/docs/Web/API/Element/setAttribute
 *   https://developer.mozilla.org/en-US/docs/Web/API/Element/replaceChildren
 *   https://developer.mozilla.org/en-US/docs/Web/API/Element/append
 */

// Diese Felder wirken nur als Eigenschaft des Elements richtig, nicht als Attribut.
const PROPERTIES = new Set(["value", "checked", "disabled", "selected", "hidden"]);

export function isAttrs(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) && value.nodeType === undefined;
}

function addChildren(node, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false || child === true) {
      continue;
    }
    if (Array.isArray(child)) {
      addChildren(node, child);
    } else {
      node.append(child); // Zeichenketten werden zu Textknoten.
    }
  }
}

function setAttrs(node, attrs) {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else if (PROPERTIES.has(key)) {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

// el("button", { class: "btn", onclick: fn }, "Text", kind, [mehr, kinder]). attrs darf fehlen oder null sein.
// Für englische Eingabefelder: el("input", { class: "input", autocorrect: "off", autocapitalize: "off", spellcheck: "false" }).
export function el(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (isAttrs(attrs)) {
    setAttrs(node, attrs);
  } else {
    children.unshift(attrs);
  }
  addChildren(node, children);
  return node;
}

export function clear(node) {
  node.replaceChildren();
}
