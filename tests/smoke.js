const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const FIXED_NOW = new Date("2026-06-27T12:00:00Z").getTime();
const RealDate = Date;

class FixedDate extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [FIXED_NOW]));
  }

  static now() {
    return FIXED_NOW;
  }
}

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(value) {
    this.values.add(value);
  }

  remove(value) {
    this.values.delete(value);
  }

  contains(value) {
    return this.values.has(value);
  }

  has(value) {
    return this.values.has(value);
  }
}

class FakeNode {
  constructor({ text = "", attrs = {} } = {}) {
    this.innerText = text;
    this.textContent = text;
    this.attrs = attrs;
    this.dataset = {};
    this.classList = new FakeClassList();
    this.children = [];
    this.parentElement = null;
    this.title = "";
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
  }

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
    }

    child.parentElement = this;
    this.children.push(child);
  }

  insertBefore(child, before) {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((item) => item !== child);
    }

    child.parentElement = this;
    const index = this.children.indexOf(before);
    if (index === -1) {
      this.children.push(child);
    } else {
      this.children.splice(index, 0, child);
    }
  }

  remove() {
    if (!this.parentElement) {
      return;
    }

    this.parentElement.children = this.parentElement.children.filter((item) => item !== this);
    this.parentElement = null;
  }

  contains(node) {
    if (node === this) {
      return true;
    }

    return this.children.some((child) => child.contains(node));
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (selector.includes("[role='button']") && node.attrs.role === "button") {
        return node;
      }

      if (selector.includes("button") && node.tagName === "button") {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  get nextSibling() {
    if (!this.parentElement) {
      return null;
    }

    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }
}

class FakeBadge extends FakeNode {
  constructor() {
    super();
    this.iconNode = new FakeNode({ text: "🌡️" });
    this.rateNode = new FakeNode({ text: "0/h" });
    this.trendNode = new FakeNode({ text: "" });
  }

  set innerHTML(value) {
    this.html = value;
  }

  get innerHTML() {
    return this.html;
  }

  querySelector(selector) {
    if (selector === ".xheat-badge__icon") return this.iconNode;
    if (selector === ".xheat-badge__rate") return this.rateNode;
    if (selector === ".xheat-badge__trend") return this.trendNode;
    return null;
  }
}

class FakeArticle extends FakeNode {
  constructor() {
    super({ attrs: { "data-testid": "tweet" } });
    this.metricNodes = {
      reply: new FakeNode({ text: "12", attrs: { "aria-label": "12 replies" } }),
      retweet: new FakeNode({ text: "3", attrs: { "aria-label": "3 reposts" } }),
      like: new FakeNode({ text: "45", attrs: { "aria-label": "45 likes" } }),
      analytics: new FakeNode({ text: "1.2K", attrs: { href: "/user/status/1/analytics" } }),
      statusLink: new FakeNode({ attrs: { href: "/demo/status/123" } }),
      time: new FakeNode({ attrs: { datetime: new RealDate(FIXED_NOW - 2 * 3600000).toISOString() } })
    };
    this.metricNodes.time.dateTime = this.metricNodes.time.attrs.datetime;
    this.actionContainer = new FakeNode();
    this.caretButton = new FakeNode({ attrs: { role: "button" } });
    this.caret = new FakeNode({ attrs: { "data-testid": "caret" } });
    this.caretButton.appendChild(this.caret);
    this.actionContainer.appendChild(this.caretButton);
    this.appendChild(this.actionContainer);
  }

  querySelector(selector) {
    if (selector === ".xheat-badge") {
      return findNode(this, (node) => node.className === "xheat-badge");
    }

    if (selector === '[data-testid="reply"]') return this.metricNodes.reply;
    if (selector === '[data-testid="retweet"]') return this.metricNodes.retweet;
    if (selector === '[data-testid="like"]') return this.metricNodes.like;
    if (selector === '[data-testid="unlike"]') return null;
    if (selector === '[data-testid="caret"]') return this.caret;
    if (selector === 'a[href*="/analytics"]') return this.metricNodes.analytics;
    if (selector === "time[datetime]") return this.metricNodes.time;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[aria-label]") {
      return [this.metricNodes.reply, this.metricNodes.retweet, this.metricNodes.like];
    }
    if (selector === 'a[href*="/status/"]') {
      return [this.metricNodes.statusLink];
    }
    if (selector.includes("[aria-label")) {
      return [];
    }
    return [];
  }
}

function findNode(root, predicate) {
  if (predicate(root)) {
    return root;
  }

  for (const child of root.children) {
    const match = findNode(child, predicate);
    if (match) {
      return match;
    }
  }

  return null;
}

const article = new FakeArticle();
const document = {
  body: {},
  readyState: "complete",
  createElement(tagName) {
    if (tagName === "div") return new FakeBadge();
    return new FakeNode();
  },
  querySelectorAll(selector) {
    if (selector === 'article[data-testid="tweet"]') return [article];
    if (selector === ".xheat-badge") return [article.querySelector(".xheat-badge")].filter(Boolean);
    if (selector === ".xheat-article-host") return [article];
    return [];
  },
  addEventListener() {}
};

const timers = [];
const context = {
  console,
  Date: FixedDate,
  Intl,
  Math,
  Number,
  Promise,
  document,
  globalThis: null,
  MutationObserver: class {
    observe() {}
  },
  window: {
    setInterval(callback) {
      timers.push(callback);
      return timers.length;
    },
    clearTimeout() {},
    setTimeout(callback) {
      callback();
      return 1;
    }
  },
  chrome: {
    storage: {
      sync: {
        get(defaults, callback) {
          callback(defaults);
        }
      },
      local: {
        get(defaults, callback) {
          callback({
            ...defaults,
            xheatSnapshots: {
              123: [
                {
                  t: FIXED_NOW - 10 * 60000,
                  impact: 80,
                  perHour: 50
                }
              ]
            }
          });
        },
        set(values, callback) {
          context.lastLocalStorageSet = values;
          callback();
        }
      },
      onChanged: {
        addListener() {}
      }
    }
  }
};
context.globalThis = context;

const source = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
vm.runInNewContext(source, context, { filename: "src/content.js" });

setImmediate(() => {
  const badge = article.querySelector(".xheat-badge");
  if (!badge) {
    throw new Error("Expected content script to append a heat badge.");
  }

  if (badge.parentElement !== article.actionContainer) {
    throw new Error("Expected content script to place the badge inside the top action container.");
  }

  if (badge.nextSibling !== article.caretButton) {
    throw new Error("Expected content script to place the badge before the caret button.");
  }

  if (article.classList.has("xheat-article-host")) {
    throw new Error("Expected inline placement to avoid fallback article positioning.");
  }

  if (badge.rateNode.textContent !== "65/h") {
    throw new Error(`Expected visible heat velocity, got ${badge.rateNode.textContent}.`);
  }

  if (badge.trendNode.textContent !== "↗4.6x") {
    throw new Error(`Expected visible acceleration trend, got ${badge.trendNode.textContent}.`);
  }

  if (badge.iconNode.textContent !== "🔥") {
    throw new Error(`Expected warm heat icon, got ${badge.iconNode.textContent}.`);
  }

  if (badge.dataset.level !== "hot") {
    throw new Error(`Expected hot heat level, got ${badge.dataset.level}.`);
  }

  if (!badge.title.includes("潜力:") || !badge.title.includes("速度: 65/h") || !badge.title.includes("最近: 294/h")) {
    throw new Error(`Expected badge tooltip to include potential and velocity signals, got: ${badge.title}`);
  }

  if (!badge.title.includes("趋势: ↗ 4.6x")) {
    throw new Error(`Expected badge tooltip to include acceleration, got: ${badge.title}`);
  }

  if (!badge.title.includes("互动质量: 9.3%") || !badge.title.includes("传播占比: 5%") || !badge.title.includes("讨论占比: 20%")) {
    throw new Error(`Expected badge tooltip to include quality signals, got: ${badge.title}`);
  }

  if (!badge.title.includes("回复: 12") || !badge.title.includes("查看: 1,200")) {
    throw new Error(`Expected badge tooltip to include parsed metrics, got: ${badge.title}`);
  }

  if (!context.lastLocalStorageSet?.xheatSnapshots?.["123"]) {
    throw new Error("Expected content script to persist an updated snapshot.");
  }

  console.log(`smoke ok: rate=${badge.rateNode.textContent}, trend=${badge.trendNode.textContent}, level=${badge.dataset.level}`);
});
