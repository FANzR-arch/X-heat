(() => {
  const CONTENT_SCRIPT_VERSION = "0.2.0";

  const DEFAULT_SETTINGS = {
    enabled: true
  };

  const BADGE_CLASS = "xheat-badge";
  const HOST_CLASS = "xheat-article-host";
  const INLINE_CLASS = "xheat-badge--inline";
  const FALLBACK_CLASS = "xheat-badge--fallback";
  const UPDATE_DEBOUNCE_MS = 120;
  const REFRESH_MS = 15000;

  const METRIC_LABELS = {
    replies: ["reply", "replies", "回复", "条回复"],
    reposts: ["repost", "reposts", "retweet", "retweets", "转帖", "转推", "转发"],
    likes: ["like", "likes", "liked", "喜欢", "点赞"],
    views: ["view", "views", "次查看", "查看", "浏览", "观看"]
  };

  const TEST_IDS = {
    replies: ["reply"],
    reposts: ["retweet"],
    likes: ["like", "unlike"]
  };

  let settings = { ...DEFAULT_SETTINGS };
  let updateTimer = 0;

  function storageGet(defaults) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.sync) {
        resolve(defaults);
        return;
      }

      globalThis.chrome.storage.sync.get(defaults, resolve);
    });
  }

  function compactNumber(value) {
    if (value >= 100000000) {
      return `${trimNumber(value / 100000000)}亿`;
    }

    if (value >= 10000) {
      return `${trimNumber(value / 10000)}万`;
    }

    return new Intl.NumberFormat().format(value);
  }

  function compactRate(value) {
    if (value >= 1000000000) {
      return `${trimNumber(value / 1000000000)}b/h`;
    }

    if (value >= 1000000) {
      return `${trimNumber(value / 1000000)}m/h`;
    }

    if (value >= 1000) {
      return `${trimNumber(value / 1000)}k/h`;
    }

    if (value >= 10) {
      return `${Math.round(value)}/h`;
    }

    return `${trimNumber(value)}/h`;
  }

  function trimNumber(value) {
    const fixed = value >= 10 ? value.toFixed(0) : value.toFixed(1);
    return fixed.replace(/\.0$/, "");
  }

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/[，]/g, ",")
      .replace(/[．]/g, ".")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseCompactCount(rawText) {
    const text = normalizeText(rawText);
    if (!text) {
      return null;
    }

    const match = text.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMBkmb]|万|億|亿|千)?/);
    if (!match) {
      return null;
    }

    const numeric = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(numeric)) {
      return null;
    }

    const unit = match[2] || "";
    const multiplier = {
      K: 1000,
      k: 1000,
      M: 1000000,
      m: 1000000,
      B: 1000000000,
      b: 1000000000,
      千: 1000,
      万: 10000,
      亿: 100000000,
      億: 100000000
    }[unit] || 1;

    return Math.round(numeric * multiplier);
  }

  function hasMetricLabel(text, metricName) {
    const lowered = normalizeText(text).toLowerCase();
    return METRIC_LABELS[metricName].some((label) => lowered.includes(label.toLowerCase()));
  }

  function parseLabeledCount(text, metricName) {
    if (!hasMetricLabel(text, metricName)) {
      return null;
    }

    return parseCompactCount(text);
  }

  function nodeTexts(node) {
    if (!node) {
      return [];
    }

    const texts = [];
    const ariaLabel = node.getAttribute?.("aria-label");
    const title = node.getAttribute?.("title");

    if (ariaLabel) {
      texts.push(ariaLabel);
    }

    if (title) {
      texts.push(title);
    }

    if (node.innerText) {
      texts.push(node.innerText);
    } else if (node.textContent) {
      texts.push(node.textContent);
    }

    return texts;
  }

  function extractButtonMetric(article, metricName) {
    const testIds = TEST_IDS[metricName] || [];

    for (const testId of testIds) {
      const node = article.querySelector(`[data-testid="${testId}"]`);
      const count = extractMetricFromNode(node, metricName);
      if (count !== null) {
        return count;
      }
    }

    return null;
  }

  function extractMetricFromNode(node, metricName) {
    for (const text of nodeTexts(node)) {
      const labeled = parseLabeledCount(text, metricName);
      if (labeled !== null) {
        return labeled;
      }

      const direct = parseCompactCount(text);
      if (direct !== null && normalizeText(text).length <= 12) {
        return direct;
      }
    }

    return null;
  }

  function extractLabeledMetricFromNode(node, metricName) {
    for (const text of nodeTexts(node)) {
      const labeled = parseLabeledCount(text, metricName);
      if (labeled !== null) {
        return labeled;
      }
    }

    return null;
  }

  function extractViews(article) {
    const analyticsLink = article.querySelector('a[href*="/analytics"]');
    const analyticsCount = extractMetricFromNode(analyticsLink, "views");
    if (analyticsCount !== null) {
      return analyticsCount;
    }

    const likelyNodes = article.querySelectorAll(
      '[aria-label*="View"], [aria-label*="view"], [aria-label*="查看"], [aria-label*="浏览"]'
    );

    for (const node of likelyNodes) {
      const count = extractLabeledMetricFromNode(node, "views");
      if (count !== null) {
        return count;
      }
    }

    for (const node of article.querySelectorAll("[aria-label]")) {
      const count = extractLabeledMetricFromNode(node, "views");
      if (count !== null) {
        return count;
      }
    }

    return 0;
  }

  function extractMetrics(article) {
    return {
      replies: extractButtonMetric(article, "replies") || 0,
      reposts: extractButtonMetric(article, "reposts") || 0,
      likes: extractButtonMetric(article, "likes") || 0,
      views: extractViews(article)
    };
  }

  function extractAgeHours(article) {
    const time = article.querySelector("time[datetime]");
    if (!time?.dateTime) {
      return 1;
    }

    const publishedAt = new Date(time.dateTime).getTime();
    if (!Number.isFinite(publishedAt)) {
      return 1;
    }

    const hours = (Date.now() - publishedAt) / 3600000;
    return Math.max(hours, 1 / 6);
  }

  function calculateHeat(metrics, ageHours) {
    const weighted =
      metrics.replies * 4.2 +
      metrics.reposts * 5.2 +
      metrics.likes * 2 +
      metrics.views * 0.045;

    const velocity = weighted / Math.pow(ageHours, 0.62);
    const perHour = weighted / ageHours;
    const score = Math.max(0, Math.min(100, Math.round(Math.log10(velocity + 1) * 30)));

    return {
      score,
      weighted,
      velocity,
      perHour
    };
  }

  function heatLevel(heat) {
    if (heat.score >= 90 || heat.perHour >= 10000) {
      return "viral";
    }

    if (heat.score >= 72 || heat.perHour >= 1000) {
      return "hot";
    }

    if (heat.score >= 50 || heat.perHour >= 100) {
      return "warm";
    }

    if (heat.score >= 25 || heat.perHour >= 20) {
      return "cool";
    }

    return "cold";
  }

  function heatIcon(level) {
    return {
      cold: "🧊",
      cool: "🌡️",
      warm: "🔥",
      hot: "🔥",
      viral: "🚀"
    }[level] || "🌡️";
  }

  function findBadgeMount(article) {
    const selectors = [
      '[data-testid="caret"]',
      '[aria-label="More"]',
      '[aria-label*="More"]',
      '[aria-label="更多"]',
      '[aria-label*="更多"]'
    ];

    for (const selector of selectors) {
      const target = article.querySelector(selector);
      if (!target || target.classList?.contains?.(BADGE_CLASS)) {
        continue;
      }

      const button = target.closest?.("button, [role='button']") || target;
      const container = button.parentElement;
      if (!container || container === article) {
        continue;
      }

      if (article.contains && !article.contains(container)) {
        continue;
      }

      return { container, before: button };
    }

    return null;
  }

  function placeBadge(article, badge) {
    const mount = findBadgeMount(article);
    if (mount) {
      article.classList.remove(HOST_CLASS);
      badge.classList.add(INLINE_CLASS);
      badge.classList.remove(FALLBACK_CLASS);

      if (badge.parentElement !== mount.container || badge.nextSibling !== mount.before) {
        mount.container.insertBefore(badge, mount.before);
      }

      return;
    }

    article.classList.add(HOST_CLASS);
    badge.classList.add(FALLBACK_CLASS);
    badge.classList.remove(INLINE_CLASS);

    if (badge.parentElement !== article) {
      article.appendChild(badge);
    }
  }

  function ensureBadge(article) {
    let badge = article.querySelector(`.${BADGE_CLASS}`);
    if (badge) {
      placeBadge(article, badge);
      return badge;
    }

    badge = document.createElement("div");
    badge.className = BADGE_CLASS;
    badge.setAttribute("aria-label", "X Heat score");
    badge.innerHTML = '<span class="xheat-badge__icon" aria-hidden="true">🌡️</span><span class="xheat-badge__rate">0/h</span>';
    placeBadge(article, badge);

    return badge;
  }

  function removeBadges() {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    document.querySelectorAll(`.${HOST_CLASS}`).forEach((article) => article.classList.remove(HOST_CLASS));
  }

  function updateArticle(article) {
    const metrics = extractMetrics(article);
    const ageHours = extractAgeHours(article);
    const heat = calculateHeat(metrics, ageHours);
    const badge = ensureBadge(article);
    const level = heatLevel(heat);

    badge.dataset.level = level;
    badge.setAttribute("aria-label", `X Heat ${compactRate(heat.perHour)}`);
    badge.querySelector(".xheat-badge__icon").textContent = heatIcon(level);
    badge.querySelector(".xheat-badge__rate").textContent = compactRate(heat.perHour);
    badge.title = [
      `热度: ${heat.score}/100`,
      `速度: ${compactRate(heat.perHour)}`,
      `回复: ${compactNumber(metrics.replies)}`,
      `转发: ${compactNumber(metrics.reposts)}`,
      `喜欢: ${compactNumber(metrics.likes)}`,
      `查看: ${compactNumber(metrics.views)}`,
      `发布: ${trimNumber(ageHours)}小时前`
    ].join("\n");
  }

  function updateAllArticles() {
    if (!settings.enabled) {
      removeBadges();
      return;
    }

    document.querySelectorAll('article[data-testid="tweet"]').forEach(updateArticle);
  }

  function scheduleUpdate() {
    window.clearTimeout(updateTimer);
    updateTimer = window.setTimeout(updateAllArticles, UPDATE_DEBOUNCE_MS);
  }

  function observePage() {
    const observer = new MutationObserver(scheduleUpdate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }

  async function init() {
    settings = await storageGet(DEFAULT_SETTINGS);
    updateAllArticles();
    observePage();
    window.setInterval(updateAllArticles, REFRESH_MS);

    globalThis.chrome?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "sync") {
        return;
      }

      if (changes.enabled) {
        settings.enabled = changes.enabled.newValue;
        updateAllArticles();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  globalThis.__XHEAT_CONTENT_SCRIPT_VERSION__ = CONTENT_SCRIPT_VERSION;
})();
