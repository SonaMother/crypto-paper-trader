/* Crypto Paper Trader — dashboard logic */

const DATA_BASE = "./data";
const FILES = {
  portfolio:     `${DATA_BASE}/portfolio.json`,
  trades:        `${DATA_BASE}/trades.json`,
  priceHistory:  `${DATA_BASE}/price_history.json`,
};

const REFRESH_INTERVAL_SECONDS = 300; // 5 minutes
let countdownSeconds = REFRESH_INTERVAL_SECONDS;
let countdownTimer = null;

let portfolioChart = null;

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

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
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function pnlClass(pnl) {
  if (pnl > 0.0001) return "text-emerald-400";
  if (pnl < -0.0001) return "text-red-400";
  return "text-slate-400";
}

function pnlBgClass(pnl) {
  if (pnl > 0.0001) return "pill-up";
  if (pnl < -0.0001) return "pill-down";
  return "pill-neutral";
}

// ----------------------------------------------------------------------------
// Fetch helpers (with cache-busting so we always see fresh data)
// ----------------------------------------------------------------------------

async function fetchJson(url) {
  const cacheBust = `${url}?t=${Date.now()}`;
  const resp = await fetch(cacheBust, { cache: "no-store" });
  if (!resp.ok) throw new Error(`Failed to fetch ${url}: ${resp.status}`);
  return resp.json();
}

// ----------------------------------------------------------------------------
// Renderers
// ----------------------------------------------------------------------------

function renderHero(portfolio, summary) {
  document.getElementById("hero-value").textContent = fmtUsd(summary.total_value_usd);
  document.getElementById("hero-cost").textContent = fmtUsd(summary.total_cost_usd);
  document.getElementById("hero-cash").textContent = fmtUsd(summary.cash_usd);
  document.getElementById("hero-updated").textContent = fmtRelative(portfolio.last_updated_at);
  document.getElementById("footer-update").textContent = `Updated ${fmtRelative(portfolio.last_updated_at)}`;

  const pnlEl = document.getElementById("hero-pnl");
  const pnl = summary.total_pnl_usd;
  const pnlPct = summary.total_pnl_pct;
  pnlEl.textContent = `${fmtUsd(pnl)} (${fmtPct(pnlPct)})`;
  pnlEl.className = `text-lg font-semibold tabular-nums ${pnlClass(pnl)}`;
}

function renderPerformance(summary) {
  const holdings = summary.holdings.filter(h => h.cost_basis_usd > 0);
  if (holdings.length === 0) {
    document.getElementById("best-perf").textContent = "—";
    document.getElementById("worst-perf").textContent = "—";
    document.getElementById("win-lose").textContent = "—";
    document.getElementById("num-positions").textContent = "0";
    return;
  }
  const sorted = [...holdings].sort((a, b) => b.pnl_pct - a.pnl_pct);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  document.getElementById("best-perf").innerHTML = `<span class="${pnlClass(best.pnl_pct)}">${best.ticker} ${fmtPct(best.pnl_pct)}</span>`;
  document.getElementById("worst-perf").innerHTML = `<span class="${pnlClass(worst.pnl_pct)}">${worst.ticker} ${fmtPct(worst.pnl_pct)}</span>`;
  const winners = holdings.filter(h => h.pnl_usd > 0).length;
  const losers = holdings.filter(h => h.pnl_usd < 0).length;
  document.getElementById("win-lose").innerHTML = `<span class="text-emerald-400">${winners}</span> / <span class="text-red-400">${losers}</span>`;
  document.getElementById("num-positions").textContent = holdings.length;
}

function renderHoldings(summary) {
  const grid = document.getElementById("holdings-grid");
  if (!summary.holdings || summary.holdings.length === 0) {
    grid.innerHTML = `<div class="col-span-full rounded-2xl bg-slate-900/60 border border-slate-800 p-6 text-slate-500 text-sm">No holdings yet.</div>`;
    return;
  }
  grid.innerHTML = summary.holdings.map(h => {
    const pnlCls = pnlClass(h.pnl_usd);
    const pnlPill = pnlBgClass(h.pnl_usd);
    const priceStr = h.last_price ? fmtPrice(h.last_price) : "—";
    const valueStr = fmtUsd(h.current_value_usd);
    const changeStr = (h.last_price && h.change_24h !== null && h.change_24h !== undefined) ? `${fmtPct(h.change_24h)} (24h)` : "";

    return `
      <div class="holding-card rounded-2xl bg-slate-900/60 border border-slate-800 p-5 relative overflow-hidden">
        <div class="absolute top-0 left-0 right-0 h-1" style="background: ${h.color}; opacity: 0.7;"></div>
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold" style="background: ${h.color}22; color: ${h.color};">
              ${h.ticker.slice(0, 2)}
            </div>
            <div>
              <div class="text-sm font-semibold text-slate-100">${h.ticker}</div>
              <div class="text-[10px] text-slate-500 uppercase tracking-wider">${h.chain}</div>
            </div>
          </div>
          <span class="text-[10px] px-2 py-0.5 rounded-full ${pnlPill}">${fmtPct(h.pnl_pct)}</span>
        </div>
        <div class="space-y-2 text-sm">
          <div class="flex justify-between">
            <span class="text-slate-500">Price</span>
            <span class="text-slate-200 tabular-nums">${priceStr}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">Holdings</span>
            <span class="text-slate-200 tabular-nums">${fmtAmount(h.amount)}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">Value</span>
            <span class="text-slate-200 tabular-nums">${valueStr}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-500">Cost</span>
            <span class="text-slate-200 tabular-nums">${fmtUsd(h.cost_basis_usd)}</span>
          </div>
          <div class="flex justify-between pt-2 mt-2 border-t border-slate-800/70">
            <span class="text-slate-500">P&amp;L</span>
            <span class="${pnlCls} font-semibold tabular-nums">${fmtUsd(h.pnl_usd)}</span>
          </div>
          ${changeStr ? `<div class="text-[10px] text-slate-500 pt-1">${changeStr}</div>` : ""}
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
    tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500">No trades yet.</td></tr>`;
    return;
  }
  // Most recent first
  const sorted = [...trades].sort((a, b) => b.epoch - a.epoch);
  tbody.innerHTML = sorted.map(t => {
    const actionClass = t.action === "BUY" ? "text-emerald-400" : "text-red-400";
    return `
      <tr class="hover:bg-slate-800/30">
        <td class="py-3 text-slate-400 text-xs whitespace-nowrap">${fmtTime(t.ts)}</td>
        <td class="py-3"><span class="text-xs font-semibold ${actionClass}">${t.action}</span></td>
        <td class="py-3 text-slate-200 font-medium">${t.ticker}</td>
        <td class="py-3 text-right text-slate-300 tabular-nums">${fmtAmount(t.amount)}</td>
        <td class="py-3 text-right text-slate-300 tabular-nums">${fmtPrice(t.price_usd)}</td>
        <td class="py-3 text-right text-slate-200 tabular-nums font-medium">${fmtUsd(t.value_usd)}</td>
        <td class="py-3 text-slate-500 text-xs">${t.note || ""}</td>
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
  const costBasis = values.length > 0 ? 4.0 : null; // we deployed $4 total

  const data = {
    labels,
    datasets: [
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
      ...(costBasis !== null ? [{
        label: "Cost Basis ($4.00)",
        data: values.map(() => costBasis),
        borderColor: "#475569",
        borderDash: [4, 4],
        borderWidth: 1,
        fill: false,
        pointRadius: 0,
        tension: 0,
      }] : []),
    ],
  };

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

// ----------------------------------------------------------------------------
// Computation (mirror of Python compute_summary)
// ----------------------------------------------------------------------------

function computeSummary(portfolio, prices) {
  const tokens = (portfolio.holdings ? Object.values(portfolio.holdings) : []);
  let totalCost = 0;
  let totalValue = portfolio.cash_usd || 0;
  const holdings = tokens.map(h => {
    const cost = h.cost_basis_usd || 0;
    const price = h.last_price || 0;
    const value = (h.amount || 0) * price;
    const pnl = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    const priceInfo = prices ? prices[h.token_id] : null;
    totalCost += cost;
    totalValue += value;
    return {
      token_id: h.token_id,
      ticker: h.ticker,
      chain: h.chain,
      color: h.color,
      amount: h.amount,
      cost_basis_usd: cost,
      last_price: price,
      current_value_usd: value,
      pnl_usd: pnl,
      pnl_pct: pnlPct,
      change_24h: priceInfo ? priceInfo.change_24h : null,
    };
  });
  return {
    created_at: portfolio.created_at,
    last_updated_at: portfolio.last_updated_at,
    cash_usd: portfolio.cash_usd || 0,
    total_cost_usd: totalCost,
    total_value_usd: totalValue,
    total_pnl_usd: totalValue - totalCost,
    total_pnl_pct: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
    holdings,
  };
}

// ----------------------------------------------------------------------------
// Main refresh
// ----------------------------------------------------------------------------

async function refresh() {
  try {
    const refreshIcon = document.getElementById("refresh-icon");
    refreshIcon.classList.add("animate-spin");
    refreshIcon.style.animationDuration = "0.8s";

    const [portfolio, trades, priceHistory] = await Promise.all([
      fetchJson(FILES.portfolio),
      fetchJson(FILES.trades),
      fetchJson(FILES.priceHistory),
    ]);

    const summary = computeSummary(portfolio, null);
    renderHero(portfolio, summary);
    renderPerformance(summary);
    renderHoldings(summary);
    renderTrades(trades);
    renderChart(priceHistory);

    // Reset countdown
    countdownSeconds = REFRESH_INTERVAL_SECONDS;
  } catch (err) {
    console.error("Refresh failed:", err);
    document.getElementById("hero-value").textContent = "—";
    document.getElementById("hero-pnl").textContent = "(refresh failed)";
  } finally {
    const refreshIcon = document.getElementById("refresh-icon");
    setTimeout(() => {
      refreshIcon.classList.remove("animate-spin");
      refreshIcon.style.animationDuration = "";
    }, 600);
  }
}

function startCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownSeconds--;
    if (countdownSeconds <= 0) {
      refresh();
    } else {
      const mins = Math.floor(countdownSeconds / 60);
      const secs = countdownSeconds % 60;
      document.getElementById("auto-refresh-text").textContent = `Auto-refresh in ${mins}m ${secs.toString().padStart(2, "0")}s`;
    }
  }, 1000);
}

// ----------------------------------------------------------------------------
// Init
// ----------------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("refresh-btn").addEventListener("click", refresh);
  // Set repo link
  const repoLink = document.getElementById("repo-link");
  if (repoLink) {
    // The dashboard is hosted on username.github.io/repo-name/, so we can derive the repo URL
    const pathParts = window.location.pathname.split("/").filter(Boolean);
    if (pathParts.length >= 1) {
      const repo = pathParts[0];
      repoLink.href = `https://github.com/SonaMother/${repo}`;
    }
  }
  refresh();
  startCountdown();
});
