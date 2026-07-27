# GitHub Actions Workflow File — Manual Setup Required (5 minutes)

The Personal Access Token you shared only has `repo` scope, not `workflow`
scope. This means we can't push the GitHub Actions workflow file via API.
**You need to add it manually via the GitHub web UI.**

This is the ONE thing that turns on 24/7 background operation. Without it:
- ✅ Dashboard live prices still work (browser-side, every 60s when page is open)
- ❌ No new historical chart points get added
- ❌ No automated rule triggers when you're not looking at the dashboard
- ❌ Activity log doesn't get new "refresh" events

With it activated:
- ✅ All of the above works 24/7, even when your PC is off
- ✅ Rules trigger automatically and execute paper sells at take-profit/stop-loss levels
- ✅ Activity log records every hourly refresh
- ✅ AI agents can trigger refreshes on-demand via the API

---

## Setup (Option A — easiest, 3 minutes)

1. **Open this URL in your browser**:
   https://github.com/SonaMother/crypto-paper-trader/actions/new

2. Click **"set up a workflow yourself"** (the link near the top, not a template)

3. GitHub shows an editor with a default `blank.yml`. **Replace everything** in the editor with this YAML:

```yaml
name: Update Portfolio

on:
  schedule:
    # Run every 15 minutes (4x/hour for responsive updates)
    - cron: '5,20,35,50 * * * *'
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: portfolio-update
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements.txt

      - name: Update portfolio
        id: update
        run: |
          python scripts/update_portfolio.py 2>&1 | tee update.log
          PNL=$(grep "P&L" update.log | head -1 | sed 's/.*P&L *: *//' || echo "unknown")
          echo "pnl_summary=$PNL" >> $GITHUB_OUTPUT

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          if git diff --cached --quiet; then
            echo "No changes to commit."
          else
            git commit -m "chore(data): portfolio update $(date -u +'%Y-%m-%dT%H:%M:%SZ') — ${{ steps.update.outputs.pnl_summary }}"
            git push
          fi
```

4. Set the filename to `update.yml` (GitHub will prefix it with `.github/workflows/` automatically — just type `update.yml` in the filename field)

5. Click **"Commit changes"** (choose "Commit directly to main")

6. Done! The first run will happen automatically on the next 5/20/35/50 minute mark. You can also trigger it manually:
   - Go to https://github.com/SonaMother/crypto-paper-trader/actions/workflows/update.yml
   - Click "Run workflow" → "Run workflow"

---

## Setup (Option B — via new PAT, 5 minutes)

If you want to be able to push workflow files via API in the future:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes: `repo` AND `workflow`
4. Generate, copy the new token
5. Clone the repo locally:
   ```bash
   git clone https://github.com/SonaMother/crypto-paper-trader.git
   cd crypto-paper-trader
   ```
6. The workflow file already exists on disk at `.github/workflows/update.yml`.
   Add and push it:
   ```bash
   git add .github/workflows/update.yml
   git commit -m "ci: add portfolio update workflow"
   git push
   ```

---

## After activation

Once the workflow is active:
- The dashboard's "Cron status" indicator will switch from "Not activated" to "Active"
- New entries will appear in the Activity Log every 15 minutes
- The portfolio value chart will start populating with hourly data points
- Automated trading rules will trigger without you needing to be online
- AI agents can trigger on-demand refreshes via `python scripts/api.py --remote refresh`

---

## ⚠️ Security reminder

**Revoke the PAT you shared publicly.** Go to https://github.com/settings/tokens
and delete the `ghp_Osiu...` token. Generate a new one with only the scopes
you need:
- For just reading the portfolio via API: `public_repo` (or use the repo without auth since it's public)
- For triggering the workflow via the dashboard's "Trigger cron" button: `repo` + `workflow`
- For full read/write via the API: `repo` + `workflow`

Store the new PAT in your browser's dashboard (the "API token" input on the
hero card) — it's saved in localStorage and only sent to GitHub's API.
