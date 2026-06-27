(() => {
  const CONTENT_SCRIPT_VERSION = "0.3.0";

  const DEFAULT_SETTINGS = {
    enabled: true
  };

  const BADGE_CLASS = "xheat-badge";
  const HOST_CLASS = "xheat-article-host";
  const INLINE_CLASS = "xheat-badge--inline";
  const FALLBACK_CLASS = "xheat-badge--fallback";
  const UPDATE_DEBOUNCE_MS = 120;
  const REFRESH_MS = 15000;
  const SNAPSHOT_STORAGE_KEY = "xheatSnapshots";
  const SNAPSHOT_MIN_INTERVAL_MS = 60000;
  const SNAPSHOT_MAX_AGE_MS = 48 * 3600000;
  const SNAPSHOT_LIMIT_PER_POST = 12;
  const SNAPSHOT_MAX_POSTS = 500;

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
  let snapshotStore = {};
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

  function storageLocalGet(defaults) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve(defaults);
        return;
      }

      globalThis.chrome.storage.local.get(defaults, resolve);
    });
  }

  function storageLocalSet(values) {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve();
        return;
      }

      globalThis.chrome.storage.local.set(values, resolve);
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

  function compactMultiplier(value) {
    if (!Number.isFinite(value)) {
      return "";
    }

    if (value >= 10) {
      return `${Math.round(value)}x`;
    }

    return `${trimNumber(value)}x`;
  }

  function formatPercent(value) {
    if (!Number.isFinite(value)) {
      return "0%";
    }

    if (value >= 0.1) {
      return `${trimNumber(value * 100)}%`;
    }

    return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
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

  function extractPostId(article) {
    const statusLinks = article.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
      const href = link.href || link.getAttribute?.("href") || "";
      const match = href.match(/\/status\/(\d+)/);
      if (match) {
        return match[1];
      }
    }

    const time = article.querySelector("time[datetime]");
    const text = normalizeText(article.querySelector('[data-testid="tweetText"]')?.textContent || "");
    if (time?.dateTime || text) {
      return `fallback:${time?.dateTime || "unknown"}:${text.slice(0, 80)}`;
    }

    return null;
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
    const actionCount = metrics.likes + metrics.replies + metrics.reposts;
    const weightedActions = metrics.likes + metrics.replies * 4 + metrics.reposts * 6;
    const impact = metrics.views * 0.015 + weightedActions;
    const quality = weightedActions / Math.max(metrics.views, 1);
    const spread = metrics.reposts / Math.max(actionCount, 1);
    const discussion = metrics.replies / Math.max(actionCount, 1);

    const velocity = impact / Math.pow(ageHours, 0.62);
    const perHour = impact / ageHours;
    const velocityScore = Math.min(45, (Math.log10(perHour + 1) / 4) * 45);
    const qualityScore = Math.min(25, quality * 250);
    const conversationScore = Math.min(15, spread * 80 + discussion * 60);
    const recencyScore = Math.max(0, 15 - Math.log2(ageHours + 1) * 3);
    const score = Math.max(0, Math.min(100, Math.round(
      velocityScore + qualityScore + conversationScore + recencyScore
    )));

    return {
      score,
      impact,
      quality,
      spread,
      discussion,
      velocity,
      perHour
    };
  }

  function calculateTrend(postId, heat, now) {
    if (!postId) {
      return null;
    }

    const snapshots = snapshotStore[postId] || [];
    const prior = [...snapshots]
      .reverse()
      .find((snapshot) => now - snapshot.t >= SNAPSHOT_MIN_INTERVAL_MS);

    if (!prior) {
      return null;
    }

    const hours = (now - prior.t) / 3600000;
    if (hours <= 0) {
      return null;
    }

    const deltaImpact = Math.max(0, heat.impact - prior.impact);
    const recentPerHour = deltaImpact / hours;
    const acceleration = recentPerHour / Math.max(heat.perHour, 1);

    return {
      recentPerHour,
      acceleration
    };
  }

  function rememberSnapshot(postId, heat, now) {
    if (!postId) {
      return false;
    }

    const existing = snapshotStore[postId] || [];
    const last = existing[existing.length - 1];
    if (last && now - last.t < SNAPSHOT_MIN_INTERVAL_MS) {
      return false;
    }

    const next = [
      ...existing.filter((snapshot) => now - snapshot.t <= SNAPSHOT_MAX_AGE_MS),
      {
        t: now,
        impact: Math.round(heat.impact * 100) / 100,
        perHour: Math.round(heat.perHour * 100) / 100
      }
    ].slice(-SNAPSHOT_LIMIT_PER_POST);

    snapshotStore[postId] = next;
    return true;
  }

  function pruneSnapshotStore(now) {
    let changed = false;

    for (const [postId, snapshots] of Object.entries(snapshotStore)) {
      const fresh = snapshots.filter((snapshot) => now - snapshot.t <= SNAPSHOT_MAX_AGE_MS);
      if (fresh.length) {
        changed = fresh.length !== snapshots.length || fresh.length > SNAPSHOT_LIMIT_PER_POST || changed;
        snapshotStore[postId] = fresh.slice(-SNAPSHOT_LIMIT_PER_POST);
      } else {
        delete snapshotStore[postId];
        changed = true;
      }
    }

    const entries = Object.entries(snapshotStore);
    if (entries.length <= SNAPSHOT_MAX_POSTS) {
      return changed;
    }

    const newestFirst = entries.sort((a, b) => {
      const aLast = a[1][a[1].length - 1]?.t || 0;
      const bLast = b[1][b[1].length - 1]?.t || 0;
      return bLast - aLast;
    });

    snapshotStore = Object.fromEntries(newestFirst.slice(0, SNAPSHOT_MAX_POSTS));
    return true;
  }

  function potentialScore(heat, trend, pageRank) {
    const trendScore = trend ? Math.min(10, Math.max(0, (trend.acceleration - 1) * 8)) : 0;
    const rankScore = pageRank?.isTop ? 5 : 0;
    return Math.max(0, Math.min(100, Math.round(heat.score + trendScore + rankScore)));
  }

  function heatLevel(signal) {
    const heat = signal.heat;
    const trend = signal.trend;
    const pageRank = signal.pageRank;
    const score = signal.potentialScore;

    if (
      score >= 85 ||
      heat.perHour >= 5000 ||
      (trend?.acceleration >= 2.5 && heat.perHour >= 1000) ||
      (pageRank?.isTop && heat.perHour >= 1000)
    ) {
      return "viral";
    }

    if (score >= 70 || heat.perHour >= 1000 || (trend?.acceleration >= 1.8 && heat.perHour >= 300)) {
      return "hot";
    }

    if (score >= 50 || heat.perHour >= 150 || (trend?.acceleration >= 1.25 && heat.perHour >= 80)) {
      return "warm";
    }

    if (score >= 30 || heat.perHour >= 50) {
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
    badge.innerHTML = '<span class="xheat-badge__icon" aria-hidden="true">🌡️</span><span class="xheat-badge__rate">0/h</span><span class="xheat-badge__trend"></span>';
    placeBadge(article, badge);

    return badge;
  }

  function removeBadges() {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    document.querySelectorAll(`.${HOST_CLASS}`).forEach((article) => article.classList.remove(HOST_CLASS));
  }

  function pageRankLabel(pageRank) {
    if (!pageRank || pageRank.total < 5) {
      return "样本不足";
    }

    if (pageRank.percentile >= 0.95) {
      return "Top 5%";
    }

    if (pageRank.percentile >= 0.8) {
      return "Top 20%";
    }

    return `第 ${pageRank.rank}/${pageRank.total}`;
  }

  function trendLabel(trend) {
    if (!trend) {
      return "采集中";
    }

    if (trend.acceleration >= 1.15) {
      return `↗ ${compactMultiplier(trend.acceleration)}`;
    }

    if (trend.acceleration <= 0.75) {
      return `↘ ${compactMultiplier(trend.acceleration)}`;
    }

    return `→ ${compactMultiplier(trend.acceleration)}`;
  }

  function updateArticle(article, signal) {
    const metrics = signal.metrics;
    const ageHours = signal.ageHours;
    const heat = signal.heat;
    const badge = ensureBadge(article);
    const level = heatLevel(signal);
    const trendText = signal.trend?.acceleration >= 1.25
      ? `↗${compactMultiplier(signal.trend.acceleration)}`
      : "";

    badge.dataset.level = level;
    badge.setAttribute("aria-label", `X Heat ${compactRate(heat.perHour)}`);
    badge.querySelector(".xheat-badge__icon").textContent = heatIcon(level);
    badge.querySelector(".xheat-badge__rate").textContent = compactRate(heat.perHour);
    badge.querySelector(".xheat-badge__trend").textContent = trendText;
    badge.title = [
      `潜力: ${signal.potentialScore}/100`,
      `速度: ${compactRate(heat.perHour)}`,
      `最近: ${signal.trend ? compactRate(signal.trend.recentPerHour) : "采集中"}`,
      `趋势: ${trendLabel(signal.trend)}`,
      `页面排名: ${pageRankLabel(signal.pageRank)}`,
      `互动质量: ${formatPercent(heat.quality)}`,
      `传播占比: ${formatPercent(heat.spread)}`,
      `讨论占比: ${formatPercent(heat.discussion)}`,
      `回复: ${compactNumber(metrics.replies)}`,
      `转发: ${compactNumber(metrics.reposts)}`,
      `喜欢: ${compactNumber(metrics.likes)}`,
      `查看: ${compactNumber(metrics.views)}`,
      `发布: ${trimNumber(ageHours)}小时前`
    ].join("\n");
  }

  async function saveSnapshotsIfNeeded(changed) {
    if (!changed) {
      return;
    }

    await storageLocalSet({ [SNAPSHOT_STORAGE_KEY]: snapshotStore });
  }

  function rankSignals(signals) {
    const ranked = [...signals].sort((a, b) => b.heat.perHour - a.heat.perHour);
    const total = ranked.length;
    const topCutoff = Math.max(1, Math.ceil(total * 0.05));

    ranked.forEach((signal, index) => {
      const percentile = total <= 1 ? 1 : 1 - index / (total - 1);
      signal.pageRank = {
        rank: index + 1,
        total,
        percentile,
        isTop: total >= 5 && index < topCutoff
      };
      signal.potentialScore = potentialScore(signal.heat, signal.trend, signal.pageRank);
    });
  }

  async function updateAllArticles() {
    if (!settings.enabled) {
      removeBadges();
      return;
    }

    const now = Date.now();
    const articles = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const signals = articles.map((article) => {
      const metrics = extractMetrics(article);
      const ageHours = extractAgeHours(article);
      const heat = calculateHeat(metrics, ageHours);
      const postId = extractPostId(article);
      const trend = calculateTrend(postId, heat, now);

      return {
        article,
        postId,
        metrics,
        ageHours,
        heat,
        trend,
        pageRank: null,
        potentialScore: heat.score
      };
    });

    rankSignals(signals);

    let snapshotChanged = false;
    for (const signal of signals) {
      updateArticle(signal.article, signal);
      snapshotChanged = rememberSnapshot(signal.postId, signal.heat, now) || snapshotChanged;
    }

    const pruned = pruneSnapshotStore(now);
    await saveSnapshotsIfNeeded(snapshotChanged || pruned);
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
    const snapshotResult = await storageLocalGet({ [SNAPSHOT_STORAGE_KEY]: {} });
    snapshotStore = snapshotResult[SNAPSHOT_STORAGE_KEY] || {};
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
