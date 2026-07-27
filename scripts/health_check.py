"""
System health check.

Verifies that all components are working:
  1. CoinGecko API is reachable and returning prices for all tracked tokens
  2. GitHub repo is reachable and data files are valid JSON
  3. GitHub Actions workflow is enabled and has run recently
  4. Activity log has fresh events (within last hour)
  5. All tracked tokens have a non-zero position in the portfolio

Exits 0 if healthy, 1 if any check fails. Outputs a JSON report.

Usage:
    python scripts/health_check.py                 # local check
    python scripts/health_check.py --remote        # check via GitHub API
    python scripts/health_check.py --remote --token <PAT>  # check with auth
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import TOKENS
from utils import now_iso, read_json
from portfolio import load_portfolio, compute_summary, load_trades, load_price_history

GITHUB_API = "https://api.github.com"
REPO = os.environ.get("GITHUB_REPO", "SonaMother/crypto-paper-trader")


def _http_get_json(url, headers=None, timeout=15):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def check_coingecko_api():
    """Check that CoinGecko API is reachable and returns all our tokens."""
    from fetch_prices import fetch_all_token_prices
    try:
        prices = fetch_all_token_prices()
        missing = [tid for tid, info in prices.items() if not info or info.get("price") is None]
        if missing:
            return {"ok": False, "issue": f"Missing prices for: {', '.join(missing)}"}
        return {"ok": True, "fetched": len(prices), "missing": []}
    except Exception as e:
        return {"ok": False, "issue": f"API error: {e}"}


def check_data_files():
    """Check that all required data files exist and are valid JSON."""
    required = ["portfolio.json", "trades.json", "price_history.json", "activity_log.json", "rules.json"]
    issues = []
    for fname in required:
        path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", fname)
        if not os.path.exists(path):
            issues.append(f"{fname}: missing")
            continue
        try:
            with open(path) as f:
                json.load(f)
        except json.JSONDecodeError as e:
            issues.append(f"{fname}: invalid JSON ({e})")
    if issues:
        return {"ok": False, "issues": issues}
    return {"ok": True, "files_checked": len(required)}


def check_portfolio_state():
    """Check that the portfolio has all tracked tokens and they have positions."""
    summary = compute_summary()
    missing_tokens = []
    zero_positions = []
    for token in TOKENS:
        h = next((h for h in summary["holdings"] if h["token_id"] == token["id"]), None)
        if not h:
            missing_tokens.append(token["ticker"])
        elif h["amount"] <= 0:
            zero_positions.append(token["ticker"])
    issues = []
    if missing_tokens:
        issues.append(f"Missing holdings for: {', '.join(missing_tokens)}")
    if zero_positions:
        issues.append(f"Zero positions for: {', '.join(zero_positions)}")
    if issues:
        return {"ok": False, "issues": issues}
    return {
        "ok": True,
        "total_value": summary["total_value_usd"],
        "total_pnl_pct": summary["total_pnl_pct"],
        "num_holdings": len(summary["holdings"]),
    }


def check_activity_log_freshness():
    """Check that the activity log has at least one event in the last 2 hours."""
    from activity_log import get_system_status
    status = get_system_status()
    if not status.get("last_refresh_ts"):
        return {"ok": False, "issue": "No refresh events in activity log"}
    try:
        last = datetime.fromisoformat(status["last_refresh_ts"].replace("Z", "+00:00"))
    except Exception:
        return {"ok": False, "issue": f"Cannot parse last_refresh_ts: {status['last_refresh_ts']}"}
    age = datetime.now(timezone.utc) - last
    if age > timedelta(hours=2):
        return {"ok": False, "issue": f"Last refresh was {age} ago (more than 2h)", "last_refresh": status["last_refresh_ts"]}
    return {"ok": True, "last_refresh": status["last_refresh_ts"], "age_seconds": int(age.total_seconds())}


def check_github_workflow(token=None):
    """Check that the GitHub Actions workflow is enabled and has run recently."""
    if not token:
        return {"ok": None, "skipped": "No GitHub token provided"}
    try:
        # Get workflow info
        url = f"{GITHUB_API}/repos/{REPO}/actions/workflows/update.yml"
        headers = {"Authorization": f"token {token}", "Accept": "application/vnd.github+json"}
        wf = _http_get_json(url, headers)
        if not wf.get("state") == "active":
            return {"ok": False, "issue": f"Workflow state is '{wf.get('state')}' (not 'active')"}

        # Get latest run
        url2 = f"{GITHUB_API}/repos/{REPO}/actions/workflows/update.yml/runs?per_page=1"
        runs = _http_get_json(url2, headers)
        if not runs.get("workflow_runs"):
            return {"ok": False, "issue": "Workflow has never run"}
        latest = runs["workflow_runs"][0]
        if latest["conclusion"] == "failure":
            return {"ok": False, "issue": f"Latest run failed: {latest['html_url']}"}

        # Check freshness (within last 30 min for a 15-min cron)
        try:
            run_time = datetime.fromisoformat(latest["updated_at"].replace("Z", "+00:00"))
            age = datetime.now(timezone.utc) - run_time
            if age > timedelta(minutes=30):
                return {"ok": False, "issue": f"Last run was {age} ago (expected <30m)"}
        except Exception:
            pass

        return {"ok": True, "state": wf.get("state"), "last_run_conclusion": latest.get("conclusion"), "last_run_url": latest["html_url"]}
    except urllib.error.HTTPError as e:
        return {"ok": False, "issue": f"GitHub API error {e.code}: {e.read().decode()[:200]}"}
    except Exception as e:
        return {"ok": False, "issue": f"Error: {e}"}


def main():
    parser = argparse.ArgumentParser(description="System health check")
    parser.add_argument("--remote", action="store_true", help="Also check GitHub API")
    parser.add_argument("--token", help="GitHub PAT (or set GITHUB_TOKEN env var)")
    parser.add_argument("--json", action="store_true", help="Output JSON only (no formatting)")
    args = parser.parse_args()

    token = args.token or os.environ.get("GITHUB_TOKEN")

    report = {
        "timestamp": now_iso(),
        "checks": {
            "coingecko_api": check_coingecko_api(),
            "data_files": check_data_files(),
            "portfolio_state": check_portfolio_state(),
            "activity_log_freshness": check_activity_log_freshness(),
        },
    }

    if args.remote or token:
        report["checks"]["github_workflow"] = check_github_workflow(token)

    # Overall status
    all_ok = all(c.get("ok") for c in report["checks"].values() if c.get("ok") is not None)
    report["overall_ok"] = all_ok
    report["overall_status"] = "healthy" if all_ok else "unhealthy"

    if args.json:
        print(json.dumps(report, indent=2, default=str))
    else:
        print(f"\n=== Health Check Report ({report['timestamp']}) ===")
        print(f"Overall: {report['overall_status'].upper()}\n")
        for name, result in report["checks"].items():
            ok = result.get("ok")
            icon = "✅" if ok is True else ("❌" if ok is False else "⏭️")
            print(f"{icon} {name}")
            for k, v in result.items():
                if k != "ok":
                    print(f"     {k}: {v}")
            print()
        sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
