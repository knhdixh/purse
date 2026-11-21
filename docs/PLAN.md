# purse: plan

A keyboard-first budgeting app on Cloudflare Workers. It plans what you **will** spend as carefully as it records what you **did** spend, and shows where each scenario leaves you.

## Concepts

| Thing | What it is | Example |
|---|---|---|
| **Balance anchor** | "On date D my balance was X." Cash now = anchor + transactions since. Re-anchor any time (reconcile). | €2,140 today |
| **Transaction** | Money that moved: signed cents, date, payee, category, tags, nature, optional link to a plan occurrence or a goal. | -12.50 coffee #treat |
| **Plan item** | Money that *will* move. Four kinds: | |
| · once | one future amount | laptop -1200 on 20 Dec |
| · repeat | every N days/weeks/months/years, optional end or count | rent -650 monthly on the 1st; salary +2400 on the 25th |
| · budget | flexible allowance per day/week/month, eaten by matching actual spending (category or tag) | groceries 300/month; treats 10/day |
| · tab | debt accruing per day/week/month since a date, minus payments, optionally settled on a date | rent 20/day since 7 Oct (45 days) = €900 owed, settle 1 Dec |
| **Scenario** | Base plan + overrides (turn an item off, change amount/dates) + items only in this scenario | "move out in Jan" |
| **Goal** | Savings target with optional date, funded by transactions or plan items marked "into goal". Goal money leaves spendable cash but counts in net worth. | emergency fund 3,000 by Jun 2027 |
| **Buffer** | The lowest cash you want to have; projections warn when a scenario dips below it | €500 |
| **Nature** | Each expense is **fixed** (repeat/tab), **everyday** (budgets, routine), **spontaneous** (unplanned one-offs) or **planned** (scheduled one-offs); plus **income**. Derived from plan link / category; overridable. | |

### No double counting
* Projections start **today**; the past is actual transactions only.
* A plan occurrence is *done* when a transaction is linked to it (plan + occurrence date) or it is skipped.
* Occurrences in the last 35 days (and after the item was added) that aren't done are **due**: listed on home (paid / skip) and counted as happening today.
* Budgets subtract what you already spent this period (category/tag match).
* Tab payments are transactions linked to the tab and reduce what's owed; a settle date pays the remainder in the projection.

## Engine (`public/engine.js`, shared, unit-tested)
`project(state, {scenarioId, today, horizon})` → daily cash / owed / goals / net, monthly buckets by nature (actual past + projected future), upcoming events, due list, lowest point vs buffer, goal ETAs, **spare** (lowest cash in the next 30 days minus buffer), **left today** (today's budget allowances). Integer cents, YYYY-MM-DD dates, day-of-month clamping.

## Input
* **Quick add** (`public/parse.js`, tested): `12.5 coffee #treat`, `+2400 salary monthly on 25`, `rent 20/day since 45d ago settle on 1.12`, `groceries 300/month` (slash rate = budget), `laptop 1200 on 20.12` (future = planned), `gym 30 monthly x12`, `@food`, `yesterday`, `mon`, `3d ago`, `!` = spontaneous. Remembers payee → category/tags. Live preview before Enter.
* **Ask / snap** (Gemini): text the parser can't read, questions, or a receipt photo → answer + proposed actions you confirm.
* **Command palette** ⌘K / Ctrl-K / `/`: quick add, ask, commands and navigation in one box.

## Keyboard
`⌘K` `/` palette · `n` add · `p` plan item · `u` snap receipt · `g h a p o t s` home/activity/plan/goals/trends/settings · `[` `]` scenario · `j/k` move · `Enter`/`e` edit · `x` delete · `f` filter · `?` help · `Esc` close.

## Views
home (spare, cash, owed, month end, projection of all scenarios, due, next 14 days, budgets, goals) · activity (day groups, search, filters) · plan (by kind, monthly equivalents, scenario overrides, live sentence preview) · goals (progress, needed per month, ETA per scenario) · trends (monthly by nature, spending calendar, categories, tags, scenario comparison) · settings.

## Look
knhdixh structure (Inter 400/500, hairline rows, square buttons, one easing curve, text reveal) inverted to warm dark: bg #15110f, ink #f3ece6, accent Pantone 7417 C **#E04E39**. Mobile: bottom tab bar + centre add, slide-up sheets, 44px targets. Desktop: left rail, every action on a key.

## Stack
Plain-JS Worker + static frontend (no build), D1, passkeys (auth kit), Gemini (`GEMINI_API_KEY` secret, `GEMINI_MODEL` var), per-user daily AI cap, hand-rolled SVG charts with hover and table views.
