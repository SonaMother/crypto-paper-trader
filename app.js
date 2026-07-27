/* ==========================================================================
   Crypto Paper Trader — dashboard logic with LIVE price fetching

   Strategy:
   - Fetch portfolio.json + trades.json + price_history.json from /data/ for
     trade history, cost basis, and historical chart data (these don't change
     often and come from the server-side Python scripts).
   - ALSO fetch live prices directly from CoinGecko's public API every 60
     seconds. This means the dashboard always shows fresh prices even if the
     server-side cron hasn't run for hours.
   - The "live" prices override the last_price in portfolio.json when computing
     current value and P&L.

   CoinGecko's public API is CORS-enabled (access-control-allow-origin: *),
   so we can call it directly from the browser. No API key needed.
   ========================================================================== */

const DATA_BASE = "./data";
const FILES = {
  portfolio:     `${DATA_BASE}/portfolio.json`,
  trades:        `${DATA_BASE}/trades.json`,
  priceHistory:  `${DATA_BASE}/price_history.json`,
  activityLog:   `${DATA_BASE}/activity_log.json`,
  rules:         `${DATA_BASE}/rules.json`,
};

const COINGECKO_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";
const GITHUB_API = "https://api.github.com";
const REPO_NAME = "SonaMother/crypto-paper-trader";
const WORKFLOW_FILENAME = "update.yml";

const REFRESH_INTERVAL_SECONDS = 60; // live price refresh interval
let countdownSeconds = REFRESH_INTERVAL_SECONDS;
let countdownTimer = null;

let portfolioChart = null;

// Cached state from server
let cachedPortfolio = null;
let cachedTrades = [];
let cachedPriceHistory = [];
let cachedActivityLog = [];
let cachedRules = [];

// Latest live prices (from CoinGecko, fetched every 60s)
let livePrices = {};  // { token_id: { price, change_24h, market_cap, volume_24h } }
let livePriceSource = "—";
let livePriceSourceTime = null;

// GitHub PAT (stored in localStorage, never committed)
let ghToken = localStorage.getItem("gh_token") || "";

// ============================================================================
// Utilities
// ============================================================================

function fmtUsd(x, decimals = 2) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  return x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtPct(x) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  const sign = x > 0 ? "+" : "";
  return `${sign}${x.toFixed(2)}%`;
}

function fmtAmount(x) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  if (x === 0) return "0";
  if (x < 0.01) return x.toFixed(8);
  if (x < 1) return x.toFixed(4);
  if (x < 1000) return x.toFixed(2);
  return x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPrice(x) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  if (x === 0) return "$0";
  if (x < 0.0001) return `$${x.toExponential(3)}`;
  if (x < 1) return `$${x.toFixed(6)}`;
  if (x < 100) return `$${x.toFixed(4)}`;
  return `$${x.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " UTC";
  } catch (e) { return iso; }
}

function fmtRelative(iso) {
  if (!iso) return "—";
  const now = new Date();
  const then = new Date(iso);
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 0) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function pnlClass(pnl) {
  if (pnl > 0.0001) return "text-up";
  if (pnl < -0.0001) return "text-down";
  return "text-muted";
}

function pnlBgClass(pnl) {
  if (pnl > 0.0001) return "pill-up";
  if (pnl < -0.0001) return "pill-down";
  return "pill-neutral";
}

function aiPillClass(ai) {
  return ai === "zAI" ? "pill-zai" : (ai === "gAi" ? "pill-gai" : "pill-neutral");
}

// ============================================================================
// Fetch helpers
// ============================================================================

async function fetchJson(url, options = {}) {
  const cacheBust = `${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`;
  const resp = await fetch(cacheBust, { cache: "no-store", ...options });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.json();
}

async function fetchLivePrices() {
  // Build a comma-separated list of CoinGecko coin IDs
  const tokens = window.TOKEN_CONFIG.tokens;
  const cgIdMap = window.TOKEN_CONFIG.coingeckoIds;
  const cgIds = tokens.map(t => cgIdMap[t.id]).filter(Boolean);
  if (cgIds.length === 0) return {};

  const url = `${COINGECKO_MARKETS}?vs_currency=usd&ids=${cgIds.join(",")}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;

  try {
    const items = await fetchJson(url);
    // CoinGecko returns an error object instead of an array when rate-limited
    if (!Array.isArray(items)) {
      const errMsg = items?.status?.error_message || "unknown error";
      console.warn("[live] CoinGecko API error:", errMsg);
      livePriceSource = "Cached (CoinGecko rate-limited)";
      return {};
    }
    const out = {};
    for (const item of items) {
      const cgId = item.id;
      // Find which token this CoinGecko ID corresponds to
      const token = tokens.find(t => cgIdMap[t.id] === cgId);
      if (!token) continue;
      out[token.id] = {
        price: item.current_price,
        change_24h: item.price_change_percentage_24h || 0,
        market_cap: item.market_cap || 0,
        volume_24h: item.total_volume || 0,
      };
    }
    if (Object.keys(out).length > 0) {
      livePriceSource = "CoinGecko (live)";
      livePriceSourceTime = new Date().toISOString();
    } else {
      livePriceSource = "Cached (no live data)";
    }
    return out;
  } catch (err) {
    console.warn("[live] CoinGecko fetch failed:", err.message);
    livePriceSource = `Cached (${err.message})`;
    return {};
  }
}

// ============================================================================
// Computation
// ============================================================================

function computeSummary(portfolio, livePrices) {
  if (!portfolio || !portfolio.holdings) {
    return { total_cost_usd: 0, total_value_usd: 0, total_pnl_usd: 0, total_pnl_pct: 0, holdings: [], per_ai: [] };
  }

  const holdings = [];
  let totalCost = 0;
  let totalValue = portfolio.cash_usd || 0;

  for (const token of window.TOKEN_CONFIG.tokens) {
    const tid = token.id;
    const h = portfolio.holdings[tid];
    const livePrice = livePrices[tid];
    const recommendedBy = token.recommended_by;

    if (!h) {
      holdings.push({
        token_id: tid,
        ticker: token.ticker,
        chain: token.chain,
        color: token.color,
        recommended_by: recommendedBy,
        amount: 0,
        cost_basis_usd: 0,
        last_price: null,
        current_value_usd: 0,
        pnl_usd: 0,
        pnl_pct: 0,
        change_24h: null,
        source: "—",
      });
      continue;
    }

    // Prefer live price; fall back to last known price in portfolio.json
    const price = (livePrice && livePrice.price) ? livePrice.price : (h.last_price || 0);
    const change24h = (livePrice && livePrice.change_24h !== undefined) ? livePrice.change_24h : null;
    const source = livePrice ? "CoinGecko (live)" : "cached";

    const cost = h.cost_basis_usd || 0;
    const value = (h.amount || 0) * price;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;

    totalCost += cost;
    totalValue += value;

    holdings.push({
      token_id: tid,
      ticker: h.ticker || token.ticker,
      chain: h.chain || token.chain,
      color: h.color || token.color,
      recommended_by: recommendedBy,
      amount: h.amount || 0,
      cost_basis_usd: cost,
      last_price: price,
      current_value_usd: value,
      pnl_usd: pnl,
      pnl_pct: pnlPct,
      change_24h: change24h,
      source: source,
    });
  }

  // Per-AI grouping
  const perAi = {};
  for (const h of holdings) {
    const ai = h.recommended_by;
    if (!perAi[ai]) {
      perAi[ai] = {
        ai,
        num_tokens: 0,
        cost_basis_usd: 0,
        current_value_usd: 0,
        pnl_usd: 0,
        pnl_pct: 0,
        tokens: [],
      };
    }
    perAi[ai].num_tokens += 1;
    perAi[ai].cost_basis_usd += h.cost_basis_usd;
    perAi[ai].current_value_usd += h.current_value_usd;
    perAi[ai].tokens.push({ ticker: h.ticker, pnl_pct: h.pnl_pct, color: h.color });
  }
  const perAiArr = Object.values(perAi).map(s => ({
    ...s,
    pnl_usd: s.current_value_usd - s.cost_basis_usd,
    pnl_pct: s.cost_basis_usd > 0 ? ((s.current_value_usd - s.cost_basis_usd) / s.cost_basis_usd) * 100 : 0,
  }));

  return {
    created_at: portfolio.created_at,
    last_updated_at: portfolio.last_updated_at,
    cash_usd: portfolio.cash_usd || 0,
    total_cost_usd: totalCost,
    total_value_usd: totalValue,
    total_pnl_usd: totalValue - totalCost,
    total_pnl_pct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    holdings,
    per_ai: perAiArr,
  };
}

// ============================================================================
// Renderers
// ============================================================================

function renderHero(portfolio, summary) {
  document.getElementById("hero-value").textContent = fmtUsd(summary.total_value_usd);
  document.getElementById("hero-cost").textContent = fmtUsd(summary.total_cost_usd);
  document.getElementById("hero-cash").textContent = fmtUsd(summary.cash_usd);
  document.getElementById("hero-updated").textContent = livePriceSourceTime ? fmtRelative(livePriceSourceTime) : fmtRelative(portfolio.last_updated_at);
  document.getElementById("hero-source").textContent = livePriceSource;
  document.getElementById("footer-update").textContent = `Live prices: ${livePriceSource}`;

  const pnlEl = document.getElementById("hero-pnl");
  const pnl = summary.total_pnl_usd;
  const pnlPct = summary.total_pnl_pct;
  pnlEl.textContent = `${fmtUsd(pnl)} (${fmtPct(pnlPct)})`;
  pnlEl.className = `hero-pnl ${pnlClass(pnl)}`;
}

function renderAiLeaderboard(summary) {
  const container = document.getElementById("ai-leaderboard");
  if (!summary.per_ai || summary.per_ai.length === 0) {
    container.innerHTML = `<div class="ai-leaderboard-row">No data yet.</div>`;
    return;
  }

  // Sort by P&L% descending
  const sorted = [...summary.per_ai].sort((a, b) => b.pnl_pct - a.pnl_pct);
  const styles = window.TOKEN_CONFIG.aiStyles;

  container.innerHTML = sorted.map((ai, idx) => {
    const style = styles[ai.ai] || { color: "#64748b", label: ai.ai, description: "" };
    const medal = idx === 0 ? "🥇" : (idx === 1 ? "🥈" : "🥉");
    return `
      <div class="ai-leaderboard-row">
        <div class="ai-leaderboard-rank">${medal}</div>
        <div class="ai-leaderboard-info">
          <span class="dot" style="background: ${style.color};"></span>
          <div>
            <div class="ai-leaderboard-name">${style.label}</div>
            <div class="ai-leaderboard-meta">${ai.num_tokens} tokens · ${style.description || ""}</div>
          </div>
        </div>
        <div class="ai-leaderboard-stats">
          <div class="ai-leaderboard-pnl ${pnlClass(ai.pnl_usd)}">${fmtUsd(ai.pnl_usd)}</div>
          <div class="ai-leaderboard-pct ${pnlClass(ai.pnl_pct)}">${fmtPct(ai.pnl_pct)}</div>
        </div>
      </div>
    `;
  }).join("");
}

function renderAiBreakdown(summary) {
  const container = document.getElementById("ai-breakdown");
  if (!summary.per_ai || summary.per_ai.length === 0) {
    container.innerHTML = `<div class="loading">No data yet.</div>`;
    return;
  }
  const styles = window.TOKEN_CONFIG.aiStyles;

  container.innerHTML = summary.per_ai.map(ai => {
    const style = styles[ai.ai] || { color: "#64748b", label: ai.ai };
    const tokenChips = ai.tokens.map(t =>
      `<span class="ai-token-chip" style="border-left: 2px solid ${t.color};">
         ${t.ticker} <span class="${pnlClass(t.pnl_pct)}">${fmtPct(t.pnl_pct)}</span>
       </span>`
    ).join("");
    return `
      <div class="ai-breakdown-card" data-ai="${ai.ai}">
        <div class="ai-breakdown-header">
          <div class="ai-breakdown-title" style="color: ${style.color};">${style.label}</div>
          <span class="pill ${aiPillClass(ai.ai)}">${ai.num_tokens} tokens</span>
        </div>
        <div class="ai-breakdown-pnl ${pnlClass(ai.pnl_usd)}">${fmtUsd(ai.pnl_usd)} <span style="font-size: 13px; font-weight: 500;">(${fmtPct(ai.pnl_pct)})</span></div>
        <div class="ai-breakdown-stats">
          <div>
            <div class="ai-breakdown-stat-label">Cost</div>
            <div class="ai-breakdown-stat-value">${fmtUsd(ai.cost_basis_usd)}</div>
          </div>
          <div>
            <div class="ai-breakdown-stat-label">Value</div>
            <div class="ai-breakdown-stat-value">${fmtUsd(ai.current_value_usd)}</div>
          </div>
          <div>
            <div class="ai-breakdown-stat-label">P&amp;L</div>
            <div class="ai-breakdown-stat-value ${pnlClass(ai.pnl_usd)}">${fmtUsd(ai.pnl_usd)}</div>
          </div>
        </div>
        <div class="ai-breakdown-tokens">${tokenChips}</div>
      </div>
    `;
  }).join("");
}

function renderHoldings(summary) {
  const grid = document.getElementById("holdings-grid");
  if (!summary.holdings || summary.holdings.length === 0) {
    grid.innerHTML = `<div class="card card-sm">No holdings yet.</div>`;
    return;
  }
  grid.innerHTML = summary.holdings.map(h => {
    const pnlCls = pnlClass(h.pnl_usd);
    const pnlPill = pnlBgClass(h.pnl_usd);
    const aiPill = aiPillClass(h.recommended_by);
    const priceStr = h.last_price ? fmtPrice(h.last_price) : "—";
    const valueStr = fmtUsd(h.current_value_usd);
    const changeStr = (h.last_price && h.change_24h !== null && h.change_24h !== undefined) ? `${fmtPct(h.change_24h)} (24h)` : "";
    const sourceStr = h.source === "CoinGecko (live)" ? '<span class="dot dot-pulse" style="background: #10b981;"></span>' : "";

    return `
      <div class="holding-card">
        <div class="holding-stripe" style="background: ${h.color};"></div>
        <div class="holding-header">
          <div class="holding-id">
            <div class="holding-logo" style="background: ${h.color}22; color: ${h.color};">
              ${h.ticker.slice(0, 2)}
            </div>
            <div>
              <div class="holding-ticker">${h.ticker}</div>
              <div class="holding-chain">${h.chain}</div>
            </div>
          </div>
          <span class="pill ${aiPill}">${h.recommended_by}</span>
        </div>
        <div class="holding-stats">
          <div class="holding-row">
            <span class="holding-label">Price</span>
            <span class="holding-value">${priceStr} ${sourceStr}</span>
          </div>
          <div class="holding-row">
            <span class="holding-label">Holdings</span>
            <span class="holding-value">${fmtAmount(h.amount)}</span>
          </div>
          <div class="holding-row">
            <span class="holding-label">Value</span>
            <span class="holding-value">${valueStr}</span>
          </div>
          <div class="holding-row">
            <span class="holding-label">Cost</span>
            <span class="holding-value">${fmtUsd(h.cost_basis_usd)}</span>
          </div>
          <div class="holding-row holding-pnl-row">
            <span class="holding-label">P&amp;L</span>
            <span class="holding-pnl ${pnlCls}">${fmtUsd(h.pnl_usd)} (${fmtPct(h.pnl_pct)})</span>
          </div>
          ${changeStr ? `<div class="holding-24h">24h: <span class="${pnlClass(h.change_24h)}">${changeStr}</span></div>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderTrades(trades) {
  const tbody = document.getElementById("trades-table");
  const count = trades.length;
  document.getElementById("trade-count").textContent = `${count} trade${count === 1 ? "" : "s"}`;
  if (count === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No trades yet.</td></tr>`;
    return;
  }
  // Most recent first
  const sorted = [...trades].sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
  tbody.innerHTML = sorted.map(t => {
    const actionClass = t.action === "BUY" ? "text-up" : "text-down";
    const aiPill = aiPillClass(t.recommended_by);
    const aiTag = t.recommended_by ? `<span class="pill ${aiPill}" style="font-size: 9px; padding: 2px 6px;">${t.recommended_by}</span>` : "";
    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 11px; white-space: nowrap;">${fmtTime(t.ts)}</td>
        <td><span style="font-size: 11px; font-weight: 600;" class="${actionClass}">${t.action}</span></td>
        <td>${aiTag}</td>
        <td style="font-weight: 500;">${t.ticker}</td>
        <td class="text-right" style="font-variant-numeric: tabular-nums;">${fmtAmount(t.amount)}</td>
        <td class="text-right" style="font-variant-numeric: tabular-nums;">${fmtPrice(t.price_usd)}</td>
        <td class="text-right" style="font-weight: 500; font-variant-numeric: tabular-nums;">${fmtUsd(t.value_usd)}</td>
        <td style="color: var(--text-muted); font-size: 11px;">${t.note || ""}</td>
      </tr>
    `;
  }).join("");
}

function renderChart(priceHistory) {
  const ctx = document.getElementById("portfolio-chart");
  if (!ctx) return;

  if (!priceHistory || priceHistory.length === 0) {
    if (portfolioChart) portfolioChart.destroy();
    return;
  }

  const labels = priceHistory.map(p => {
    const d = new Date(p.ts);
    return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  });
  const values = priceHistory.map(p => p.portfolio_value_usd);
  const costBasis = values.length > 0 ? 6.0 : null; // we deployed $6 total ($4 zAI + $2 gAi)

  const datasets = [
    {
      label: "Portfolio Value (USD)",
      data: values,
      borderColor: "#8b5cf6",
      backgroundColor: (ctx) => {
        const chart = ctx.chart;
        const { ctx: canvasCtx, chartArea } = chart;
        if (!chartArea) return "rgba(139, 92, 246, 0.1)";
        const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
        gradient.addColorStop(0, "rgba(139, 92, 246, 0.35)");
        gradient.addColorStop(1, "rgba(139, 92, 246, 0.0)");
        return gradient;
      },
      borderWidth: 2,
      fill: true,
      tension: 0.25,
      pointRadius: 0,
      pointHoverRadius: 5,
      pointHoverBackgroundColor: "#8b5cf6",
      pointHoverBorderColor: "#ffffff",
      pointHoverBorderWidth: 2,
    },
  ];

  if (costBasis !== null) {
    datasets.push({
      label: "Cost Basis ($6.00)",
      data: values.map(() => costBasis),
      borderColor: "#475569",
      borderDash: [4, 4],
      borderWidth: 1,
      fill: false,
      pointRadius: 0,
      tension: 0,
    });
  }

  // If we have live price, append a "now" point
  if (cachedPortfolio && Object.keys(livePrices).length > 0) {
    const summary = computeSummary(cachedPortfolio, livePrices);
    datasets[0].data.push(summary.total_value_usd);
    labels.push("now");
  }

  const data = { labels, datasets };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        display: true,
        position: "top",
        align: "end",
        labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 12, boxHeight: 12, padding: 12 },
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.95)",
        borderColor: "#1e293b",
        borderWidth: 1,
        titleColor: "#e2e8f0",
        bodyColor: "#cbd5e1",
        padding: 10,
        cornerRadius: 6,
        callbacks: {
          label: (item) => `${item.dataset.label}: ${fmtUsd(item.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(30, 41, 59, 0.4)", drawBorder: false },
        ticks: { color: "#64748b", font: { size: 10 }, maxTicksLimit: 8 },
      },
      y: {
        grid: { color: "rgba(30, 41, 59, 0.4)", drawBorder: false },
        ticks: {
          color: "#64748b",
          font: { size: 10 },
          callback: (v) => "$" + v.toFixed(2),
        },
      },
    },
  };

  if (portfolioChart) portfolioChart.destroy();
  portfolioChart = new Chart(ctx, { type: "line", data, options });
}

// ============================================================================
// Main refresh
// ============================================================================

async function refreshAll() {
  const refreshIcon = document.getElementById("refresh-icon");
  refreshIcon.classList.add("spin");

  try {
    // Fetch server-side data + live prices in parallel
    const [portfolio, trades, priceHistory, activityLog, rules, live] = await Promise.all([
      fetchJson(FILES.portfolio),
      fetchJson(FILES.trades),
      fetchJson(FILES.priceHistory),
      fetchJson(FILES.activityLog).catch(() => []),
      fetchJson(FILES.rules).catch(() => []),
      fetchLivePrices(),
    ]);

    cachedPortfolio = portfolio;
    cachedTrades = trades;
    cachedPriceHistory = priceHistory;
    cachedActivityLog = activityLog;
    cachedRules = rules;
    livePrices = live;

    const summary = computeSummary(portfolio, live);
    renderHero(portfolio, summary);
    renderAiLeaderboard(summary);
    renderAiBreakdown(summary);
    renderHoldings(summary);
    renderTrades(trades);
    renderChart(priceHistory);
    renderSystemStatus(activityLog, rules);
    renderActivityLog(activityLog);
    renderRulesList(rules);

    countdownSeconds = REFRESH_INTERVAL_SECONDS;
  } catch (err) {
    console.error("Refresh failed:", err);
    document.getElementById("hero-value").textContent = "—";
    document.getElementById("hero-pnl").textContent = "(refresh failed)";
  } finally {
    setTimeout(() => {
      refreshIcon.classList.remove("spin");
    }, 500);
  }
}

// "Live only" refresh — only re-fetch live prices and re-render (faster, less load)
async function refreshLiveOnly() {
  if (!cachedPortfolio) return;
  try {
    const live = await fetchLivePrices();
    livePrices = live;
    const summary = computeSummary(cachedPortfolio, live);
    renderHero(cachedPortfolio, summary);
    renderAiLeaderboard(summary);
    renderAiBreakdown(summary);
    renderHoldings(summary);
    renderChart(cachedPriceHistory);
  } catch (err) {
    console.warn("[live] refresh failed:", err.message);
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      refreshLiveOnly();
      countdownSeconds = REFRESH_INTERVAL_SECONDS;
    } else {
      document.getElementById("auto-refresh-text").textContent = `Live · updating in ${countdownSeconds}s`;
    }
  }, 1000);
}

// ============================================================================
// System status, activity log, rules list renderers
// ============================================================================

function renderSystemStatus(activityLog, rules) {
  // Cron status: derived from whether we have any "refresh" events
  const lastRefresh = activityLog ? activityLog.find(e => e.action === "refresh" || e.action === "refresh_failed") : null;
  const lastRefreshFailed = activityLog ? activityLog.find(e => e.action === "refresh_failed") : null;
  const lastAiAction = activityLog ? activityLog.find(e => ["buy", "sell", "rule_triggered", "rule_added"].includes(e.action) && e.actor !== "cron" && e.actor !== "system") : null;
  const enabledRules = rules ? rules.filter(r => r.enabled) : [];

  // Cron status
  const cronEl = document.getElementById("status-cron");
  const cronDetailEl = document.getElementById("status-cron-detail");
  if (lastRefresh) {
    if (lastRefreshFailed && lastRefreshFailed.ts >= (lastRefresh.ts || "")) {
      cronEl.textContent = "Degraded";
      cronEl.className = "status-value text-down";
      cronDetailEl.textContent = `Last run failed: ${fmtRelative(lastRefreshFailed.ts)}`;
    } else {
      cronEl.textContent = "Active";
      cronEl.className = "status-value text-up";
      cronDetailEl.textContent = `Last successful run: ${fmtRelative(lastRefresh.ts)}`;
    }
  } else {
    cronEl.textContent = "Not activated";
    cronEl.className = "status-value text-muted";
    cronDetailEl.textContent = "See SETUP_WORKFLOW.md to activate";
  }

  // Last refresh
  document.getElementById("status-last-refresh").textContent = lastRefresh ? fmtRelative(lastRefresh.ts) : "—";
  document.getElementById("status-last-refresh-detail").textContent = lastRefresh ? (lastRefresh.details || "").slice(0, 80) : "No refreshes yet";

  // Last AI action
  document.getElementById("status-last-ai").textContent = lastAiAction ? `${lastAiAction.actor}` : "—";
  document.getElementById("status-last-ai-detail").textContent = lastAiAction ? `${lastAiAction.action} · ${fmtRelative(lastAiAction.ts)}` : "No AI actions yet";

  // Active rules
  document.getElementById("status-rules").textContent = enabledRules.length;
  document.getElementById("status-rules-detail").textContent = `${rules ? rules.length : 0} total (incl. disabled)`;
}

function renderActivityLog(activityLog) {
  const tbody = document.getElementById("activity-table");
  const countEl = document.getElementById("activity-count");
  if (!activityLog || activityLog.length === 0) {
    countEl.textContent = "0 events";
    tbody.innerHTML = `<tr><td colspan="4" class="table-empty">No activity yet.</td></tr>`;
    return;
  }
  // activityLog is stored oldest-last, but we want newest-first on display
  const sorted = [...activityLog].sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
  countEl.textContent = `${activityLog.length} event${activityLog.length === 1 ? "" : "s"}`;
  tbody.innerHTML = sorted.slice(0, 50).map(e => {
    const actorClass = `actor-pill actor-pill-${(e.actor || "system").replace(/[^a-zA-Z]/g, "")}`;
    const actionClass = `action-pill action-pill-${e.action || ""}`;
    return `
      <tr>
        <td style="color: var(--text-muted); font-size: 11px; white-space: nowrap;">${fmtTime(e.ts)}</td>
        <td><span class="${actorClass}">${e.actor || "?"}</span></td>
        <td><span class="${actionClass}">${e.action || "?"}</span></td>
        <td style="color: var(--text-secondary); font-size: 12px;">${e.details || ""}</td>
      </tr>
    `;
  }).join("");
}

function renderRulesList(rules) {
  const container = document.getElementById("rules-list");
  const countEl = document.getElementById("rules-count");
  if (!rules || rules.length === 0) {
    countEl.textContent = "0 rules";
    container.innerHTML = `<div class="loading">No rules configured.</div>`;
    return;
  }
  countEl.textContent = `${rules.length} rule${rules.length === 1 ? "" : "s"}`;
  container.innerHTML = rules.map(r => {
    const enabledClass = r.enabled ? "" : "rule-row-disabled";
    const typeClass = `rule-type-pill rule-type-${r.type}`;
    const thresholdStr = r.threshold > 0 ? `+${r.threshold}%` : `${r.threshold}%`;
    return `
      <div class="rule-row ${enabledClass}">
        <span class="${typeClass}">${r.type.replace("_", " ")}</span>
        <span class="rule-token">${r.token_id === "all" ? "ALL" : r.token_id.toUpperCase()}</span>
        <div>
          <div class="rule-desc">${r.note || ""}</div>
          <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
            by <span style="color: var(--text-secondary);">${r.created_by || "?"}</span> ·
            <span class="rule-threshold">trigger at ${thresholdStr} P&L</span> ·
            <span class="rule-threshold">action: ${r.action}</span>
          </div>
        </div>
        <span class="pill ${r.enabled ? "pill-up" : "pill-neutral"}" style="font-size: 10px;">${r.enabled ? "ON" : "OFF"}</span>
      </div>
    `;
  }).join("");
}

// ============================================================================
// Trigger refresh (uses GitHub API workflow_dispatch)
// ============================================================================

async function triggerCronRefresh() {
  const btn = document.getElementById("force-refresh-btn");
  const resultEl = document.getElementById("force-refresh-result");
  if (!ghToken) {
    resultEl.textContent = "Enter a GitHub PAT above first";
    resultEl.className = "status-detail text-down";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Triggering…";
  resultEl.textContent = "";
  try {
    const url = `${GITHUB_API}/repos/${REPO_NAME}/actions/workflows/${WORKFLOW_FILENAME}/dispatches`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `token ${ghToken}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ ref: "main" }),
    });
    if (resp.status === 204) {
      resultEl.textContent = "✓ Triggered. Refresh will run in ~30s.";
      resultEl.className = "status-detail text-up";
      // Auto-refresh dashboard after 60s to see new data
      setTimeout(() => refreshAll(), 60000);
    } else if (resp.status === 404) {
      resultEl.textContent = "Workflow file not found — see SETUP_WORKFLOW.md";
      resultEl.className = "status-detail text-down";
    } else if (resp.status === 401 || resp.status === 403) {
      resultEl.textContent = "Token lacks 'workflow' scope";
      resultEl.className = "status-detail text-down";
    } else {
      const text = await resp.text();
      resultEl.textContent = `Error ${resp.status}: ${text.slice(0, 100)}`;
      resultEl.className = "status-detail text-down";
    }
  } catch (err) {
    resultEl.textContent = `Failed: ${err.message}`;
    resultEl.className = "status-detail text-down";
  } finally {
    btn.disabled = false;
    btn.textContent = "Trigger cron";
  }
}

// ============================================================================
// Init
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refresh-btn").addEventListener("click", refreshAll);
  document.getElementById("force-refresh-btn").addEventListener("click", triggerCronRefresh);

  // Restore saved GitHub token to input
  const tokenInput = document.getElementById("gh-token-input");
  if (tokenInput && ghToken) {
    tokenInput.value = ghToken;
  }
  document.getElementById("save-token-btn").addEventListener("click", () => {
    const val = document.getElementById("gh-token-input").value.trim();
    if (val) {
      localStorage.setItem("gh_token", val);
      ghToken = val;
      document.getElementById("save-token-btn").textContent = "Saved ✓";
      setTimeout(() => { document.getElementById("save-token-btn").textContent = "Save"; }, 1500);
    } else {
      localStorage.removeItem("gh_token");
      ghToken = "";
    }
  });

  const repoLink = document.getElementById("repo-link");
  if (repoLink) {
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 1) {
      const repo = pathParts[0];
      repoLink.href = `https://github.com/SonaMother/${repo}`;
    }
  }
  refreshAll();
  startCountdown();
});
