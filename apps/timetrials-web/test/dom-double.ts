// The DOM double the web tests drive the product against. It is not a mock of the product: it is a
// small, honest implementation of the parts of the DOM the design-system factories and the route
// views actually use — text that is the element's own text plus its descendants', children that are
// replaced by an assignment, attributes, classes, data attributes, listeners and focus.
//
// It lives here rather than inside one test file because Phase 6 migrated two routes onto the same
// factories, and two copies of a harness drift apart.

export class FakeNode {
  readonly children: FakeNode[] = [];
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (name: string) => { this.className = `${this.className} ${name}`.trim(); },
    remove: (name: string) => {
      this.className = this.className.split(" ").filter((entry) => entry !== name).join(" ");
    },
    toggle: (name: string, force?: boolean) => {
      const has = this.className.split(" ").includes(name);
      const next = force ?? !has;
      if (next && !has) { this.classList.add(name); }
      if (!next && has) { this.classList.remove(name); }
      return next;
    },
    contains: (name: string) => this.className.split(" ").includes(name),
  };
  parentNode: FakeNode | null = null;
  className = "";
  private ownText: string | null = null;
  // As in the DOM: an element's text content is its own text plus its descendants', and assigning
  // text replaces the children. The design-system factories pass labels as children, so a double
  // that kept text and children apart would report the wrong thing for every component.
  get textContent(): string | null {
    if (this.children.length === 0) { return this.ownText; }
    return `${this.ownText ?? ""}${this.children.map((child) => child.textContent ?? "").join("")}`;
  }

  set textContent(value: string | null) {
    for (const child of this.children.splice(0)) { child.parentNode = null; }
    this.ownText = value;
  }
  type = "";
  name = "";
  value = "";
  href = "";
  src = "";
  alt = "";
  loading = "";
  title = "";
  placeholder = "";
  autocomplete = "";
  maxLength = -1;
  tabIndex = 0;
  open = false;
  required = false;
  disabled = false;
  hidden = false;
  private readonly listeners = new Map<string, Set<(event: Event) => void>>();

  // Inline styles the components set for a measured size (a rank column in ch, a bar's share).
  readonly style = {
    values: new Map<string, string>(),
    color: "",
    setProperty(name: string, value: string) { this.values.set(name, value); },
    removeProperty(name: string) { this.values.delete(name); },
    getPropertyValue(name: string) { return this.values.get(name) ?? ""; },
  };

  public constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}

  private matches(selector: string): boolean {
    // Enough of a selector to find a component: a tag, one class, or a class with one attribute.
    const [head, ...rest] = selector.split("[");
    const attribute = rest.length === 0 ? null : rest.join("[").replace(/\]$/u, "");
    if (attribute !== null) {
      const [attributeName, rawValue] = attribute.split("=");
      const value = rawValue?.replace(/^["']|["']$/gu, "");
      const held = this.attributes.get(attributeName ?? "");
      if (held === undefined || (value !== undefined && held !== value)) { return false; }
    }
    const wanted = (head ?? "").trim();
    if (wanted === "") { return true; }
    return wanted.startsWith(".")
      ? this.className.split(" ").includes(wanted.slice(1))
      : this.tagName === wanted;
  }

  public querySelector(selector: string): FakeNode | null {
    return descendants(this).find((candidate) => candidate.matches(selector)) ?? null;
  }

  public querySelectorAll(selector: string): FakeNode[] {
    return descendants(this).filter((candidate) => candidate.matches(selector));
  }

  public contains(node: FakeNode | null): boolean {
    if (node === null) { return false; }
    return node === this || descendants(this).includes(node);
  }

  public get isConnected(): boolean { return this.parentNode !== null; }

  public focus(): void { this.ownerDocument.activeElement = this; }

  public get firstChild(): FakeNode | null { return this.children[0] ?? null; }

  /** As in the DOM: the *element* children, which is what a view counts before it appends a box. */
  public get childElementCount(): number {
    return this.children.filter((child) => child.tagName !== "#text").length;
  }

  public get childNodes(): readonly FakeNode[] { return this.children; }

  public get lastElementChild(): FakeNode | null { return this.children[this.children.length - 1] ?? null; }

  // The design-system factories pass label text as a child, exactly as the DOM allows. A text child
  // is a node of its own here, as it is in the DOM, so a line built of words and elements reads in
  // the order it was written — "[NS1] Ben's Switch", not the words first and the names after.
  append(...nodes: (FakeNode | string)[]): void {
    for (const node of nodes) {
      if (typeof node === "string") {
        if (node === "") { continue; }
        const text = new FakeNode("#text", this.ownerDocument);
        text.textContent = node;
        text.parentNode = this;
        this.children.push(text);
        continue;
      }
      node.parentNode = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: (FakeNode | string)[]): void {
    this.textContent = null;
    this.append(...nodes);
  }

  removeChild(node: FakeNode): FakeNode {
    const index = this.children.indexOf(node);
    if (index < 0) { throw new Error("synthetic child missing"); }
    this.children.splice(index, 1);
    node.parentNode = null;
    return node;
  }

  remove(): void { this.parentNode?.removeChild(this); }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }

  /** The properties the DOM reflects from an attribute, so `node.href` reads what `el()` set. */
  private static readonly reflected = new Set([
    "href", "src", "alt", "loading", "title", "placeholder", "type", "value", "autocomplete",
  ]);

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (FakeNode.reflected.has(name)) {
      (this as unknown as Record<string, string>)[name] = value;
    }
  }

  removeAttribute(name: string): void { this.attributes.delete(name); }

  toggleAttribute(name: string, force?: boolean): boolean {
    const has = this.attributes.has(name);
    const next = force ?? !has;
    if (next) { this.attributes.set(name, ""); } else { this.attributes.delete(name); }
    return next;
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string): void {
    const event = new Event(type, { cancelable: true });
    // A click carries the button and the modifier keys; a component that only acts on a plain left
    // click (the tabs) must see a plain left click here.
    for (const [name, value] of [["button", 0], ["metaKey", false], ["ctrlKey", false],
      ["shiftKey", false], ["altKey", false]] as const) {
      Object.defineProperty(event, name, { value, configurable: true });
    }
    for (const listener of this.listeners.get(type) ?? []) { listener(event); }
  }

  /** A plain left click, the way a person makes one. */
  click(): void { this.dispatch("click"); }

  /** Details emits toggle after its open state changes. */
  toggle(): void { this.dispatch("toggle"); }

  showModal(): void { this.open = true; }

  close(): void { this.open = false; this.dispatch("close"); }
}

export class FakeDocument {
  activeElement: FakeNode | null = null;
  readonly documentElement = new FakeNode("html", this);
  readonly body = new FakeNode("body", this);
  defaultView: unknown = undefined;
  createElement(tagName: string): FakeNode { return new FakeNode(tagName, this); }
  createElementNS(_namespace: string, tagName: string): FakeNode {
    return new FakeNode(tagName, this);
  }
  createTextNode(text: string): FakeNode {
    const node = new FakeNode("#text", this);
    node.textContent = text;
    return node;
  }
  querySelector(selector: string): FakeNode | null { return this.body.querySelector(selector); }
}

/** Every *element* under a node, which is what a test points at. Text nodes are not elements. */
export function descendants(root: FakeNode): FakeNode[] {
  return root.children
    .filter((child) => child.tagName !== "#text")
    .flatMap((child) => [child, ...descendants(child)]);
}

/** Every text on the page, the way a reader would find it. */
export function texts(root: FakeNode): string[] {
  return descendants(root).map((node) => node.textContent ?? "");
}

/** The first node carrying a class, as a test would point at a component. */
export function byClass(root: FakeNode, className: string): FakeNode | undefined {
  return descendants(root).find((node) => node.className.split(" ").includes(className));
}

export function allByClass(root: FakeNode, className: string): FakeNode[] {
  return descendants(root).filter((node) => node.className.split(" ").includes(className));
}
