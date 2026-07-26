"""
One-shot migration script: backfills the 'recommended_by' field on existing
trades in trades.json (so the original 4 zAI BUY trades get tagged correctly).

Run once after adding recommended_by to config.py:
    python scripts/migrate_add_recommended_by_trades.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import TOKENS
from portfolio import load_trades, save_trades


def main():
    trades = load_trades()
    updated = 0
    token_map = {t["id"]: t for t in TOKENS}

    for trade in trades:
        tid = trade.get("token_id")
        if tid in token_map:
            correct_ai = token_map[tid].get("recommended_by", "unknown")
            if trade.get("recommended_by") != correct_ai:
                trade["recommended_by"] = correct_ai
                updated += 1
                print(f"  Updated trade {trade['id'][:8]}... ({trade['ticker']}): recommended_by = {correct_ai}")

    save_trades(trades)
    print(f"\n✓ Migration complete. Updated {updated} trades.")


if __name__ == "__main__":
    main()
