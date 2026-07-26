# GitHub Actions Workflow File — Manual Setup Required

The Personal Access Token you provided only has `repo` scope, not `workflow`
scope. This means we couldn't push the GitHub Actions workflow file directly.
You have two options to activate the hourly auto-update:

## Option 1: Add the workflow file via GitHub Web UI (EASIEST)

1. Go to: https://github.com/SonaMother/crypto-paper-trader/actions/new
2. Click "set up a workflow yourself" (skip the suggested templates)
3. Replace the default content with the YAML below
4. Name the file `update.yml` (in the `.github/workflows/` directory — GitHub
   will auto-prefix it)
5. Click "Commit changes"
6. The first run will happen automatically on the next hour mark (`HH:05`)

### Paste this YAML:

```yaml
name: Update Portfolio

on:
  schedule:
    # Run every hour at minute 5 (offset from :00 to avoid GitHub Actions cron peaks)
    - cron: '5 * * * *'
  workflow_dispatch: {}   # Allow manual trigger from the Actions tab

permissions:
  contents: write          # Required so the bot can commit and push updates

jobs:
  update:
    runs-on: ubuntu-latest
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
        run: |
          python scripts/update_portfolio.py

      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add data/
          if git diff --cached --quiet; then
            echo "No changes to commit."
          else
            git commit -m "chore(data): hourly portfolio update $(date -u +'%Y-%m-%dT%H:%M:%SZ')"
            git push
          fi
```

## Option 2: Generate a new PAT with `workflow` scope and push locally

1. Go to: https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Select scopes: `repo` AND `workflow`
4. Generate, copy the new token
5. Clone the repo locally:
   ```bash
   git clone https://github.com/SonaMother/crypto-paper-trader.git
   cd crypto-paper-trader
   ```
6. The workflow file already exists in your local clone at
   `.github/workflows/update.yml`. Add and push it:
   ```bash
   git add .github/workflows/update.yml
   git commit -m "ci: add hourly portfolio update workflow"
   git push
   ```

## Option 3: Run updates manually

Until you set up the cron, you can refresh prices manually anytime:

```bash
git clone https://github.com/SonaMother/crypto-paper-trader.git
cd crypto-paper-trader
python scripts/update_portfolio.py
git add data/
git commit -m "data: manual refresh"
git push
```

The dashboard will auto-refresh every 5 minutes once you open it, so as soon
as you push new data, the dashboard shows the new values.

---

## ⚠️ Security reminder

The PAT you shared publicly (`ghp_...`) has been used to set up this repo.
**Please revoke it now** at https://github.com/settings/tokens and generate
a new one with only the scopes you need (e.g. `repo` + `workflow` for this
project). Even though the repo is public, the PAT could be used to push
malicious code to any of your repos.
