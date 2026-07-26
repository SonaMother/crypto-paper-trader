"""
One-shot migration script: backfills the 'recommended_by' field on existing
holdings in portfolio.json (so the original 4 zAI picks get tagged correctly).

Run once after adding recommended_by to config.py:
    python scripts/migrate_add_recommended_by.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from config import TOKENS
from portfolio import load_portfolio, save_portfolio


def main():
    p = load_portfolio()
    updated = 0
    for token in TOKENS:
        tid = token["id"]
        if tid in p["holdings"]:
            h = p["holdings"][tid]
            if "recommended_by" not in h or not h["recommended_by"]:
                h["recommended_by"] = token.get("recommended_by", "unknown")
                updated += 1
                print(f"  Updated {token['ticker']}: recommended_by = {h['recommended_by']}")
            else:
                print(f"  Already set: {token['ticker']} -> {h['recommended_by']}")
    save_portfolio(p)
    print(f"\n✓ Migration complete. Updated {updated} holdings.")


if __name__ == "__main__":
    main()
