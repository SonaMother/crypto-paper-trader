"""
Refresh all token prices and update the portfolio's mark-to-market value.

This is the script that GitHub Actions runs every hour.
Safe to run anytime locally as well.

Usage:
    python scripts/update_portfolio.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fetch_prices import fetch_all_token_prices
from portfolio import update_prices, compute_summary
from utils import fmt_usd, fmt_pct


def main():
    print("Fetching live prices from CoinGecko...")
    prices = fetch_all_token_prices()
    print("\nLive prices:")
    fetched_count = 0
    failed_count = 0
    for tid, info in prices.items():
        if info.get("price") is None:
            print(f"  {tid:10s}  UNAVAILABLE")
            failed_count += 1
        else:
            print(f"  {tid:10s}  ${info['price']:<14.8g}  24h: {info.get('change_24h', 0):+.2f}%")
            fetched_count += 1

    print(f"\nFetched: {fetched_count}/{fetched_count + failed_count}")

    if fetched_count == 0:
        print("\n[warn] No prices could be fetched (likely rate-limited).")
        print("[warn] Portfolio not updated this run.")
        print("[warn] The dashboard will still show cached prices from the last successful update.")
        return

    print("\nUpdating portfolio...")
    update_prices(prices)

    s = compute_summary()
    print("\nPortfolio summary:")
    print(f"  Total cost basis : {fmt_usd(s['total_cost_usd'])}")
    print(f"  Current value    : {fmt_usd(s['total_value_usd'])}")
    print(f"  P&L              : {fmt_usd(s['total_pnl_usd'])} ({fmt_pct(s['total_pnl_pct'])})")
    print(f"  Last updated     : {s['last_updated_at']}")
    print("\nPer-AI breakdown:")
    for ai in s.get('per_ai', []):
        print(f"  {ai['ai']}: {ai['num_tokens']} tokens, P&L = {fmt_usd(ai['pnl_usd'])} ({fmt_pct(ai['pnl_pct'])})")
    print("\n✓ Done.")


if __name__ == "__main__":
    main()
