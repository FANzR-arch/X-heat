const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
    this.title = "";
  }

  getAttribute(name) {
    return this.attrs[name] || null;
  }

  setAttribute(name, value) {
    this.attrs[name] = value;
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
    this.scoreNode = new FakeNode({ text: "0" });
  }

  set innerHTML(value) {
    this.html = value;
  }

  get innerHTML() {
    return this.html;
  }

  querySelector(selector) {
    return selector === ".xheat-badge__score" ? this.scoreNode : null;
  }
}

class FakeArticle extends FakeNode {
  constructor() {
    super({ attrs: { "data-testid": "tweet" } });
    this.children = [];
    this.metricNodes = {
      reply: new FakeNode({ text: "12", attrs: { "aria-label": "12 replies" } }),
      retweet: new FakeNode({ text: "3", attrs: { "aria-label": "3 reposts" } }),
      like: new FakeNode({ text: "45", attrs: { "aria-label": "45 likes" } }),
      analytics: new FakeNode({ text: "1.2K", attrs: { href: "/user/status/1/analytics" } }),
      time: new FakeNode({ attrs: { datetime: new Date(Date.now() - 2 * 3600000).toISOString() } })
    };
    this.metricNodes.time.dateTime = this.metricNodes.time.attrs.datetime;
  }

  appendChild(child) {
    this.children.push(child);
  }

  querySelector(selector) {
    if (selector === '[data-testid="reply"]') return this.metricNodes.reply;
    if (selector === '[data-testid="retweet"]') return this.metricNodes.retweet;
    if (selector === '[data-testid="like"]') return this.metricNodes.like;
    if (selector === '[data-testid="unlike"]') return null;
    if (selector === 'a[href*="/analytics"]') return this.metricNodes.analytics;
    if (selector === "time[datetime]") return this.metricNodes.time;
    if (selector === ":scope > .xheat-badge") {
      return this.children.find((child) => child.className === "xheat-badge") || null;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (selector === "[aria-label]") {
      return [this.metricNodes.reply, this.metricNodes.retweet, this.metricNodes.like];
    }
    if (selector.includes("[aria-label")) {
      return [];
    }
    return [];
  }
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
    if (selector === ".xheat-badge") return article.children.filter((child) => child.className === "xheat-badge");
    if (selector === ".xheat-article-host") return [article];
    return [];
  },
  addEventListener() {}
};

const timers = [];
const context = {
  console,
  Date,
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
  const badge = article.children.find((child) => child.className === "xheat-badge");
  if (!badge) {
    throw new Error("Expected content script to append a heat badge.");
  }

  if (!article.classList.has("xheat-article-host")) {
    throw new Error("Expected content script to mark the article as a badge host.");
  }

  const score = Number(badge.scoreNode.textContent);
  if (!Number.isFinite(score) || score <= 0 || score > 100) {
    throw new Error(`Expected a 1-100 heat score, got ${badge.scoreNode.textContent}.`);
  }

  if (!badge.title.includes("回复: 12") || !badge.title.includes("查看: 1,200")) {
    throw new Error(`Expected badge tooltip to include parsed metrics, got: ${badge.title}`);
  }

  console.log(`smoke ok: score=${score}, level=${badge.dataset.level}`);
});
