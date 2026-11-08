# data-analyst

An AI data analyst in your terminal, powered by Claude (Claude Opus 5.5).
Put your spreadsheets in a folder and ask questions in plain Thai or English. Claude answers by **writing and
running real Python code** (pandas, matplotlib) in Anthropic's secure sandbox, so the numbers come from
actual calculations, not guesses. Charts and tables it makes are saved to your computer.

```
> Which days and dishes make the most money? Make a chart.
  ⬆ uploading sample-karena-sales.csv (180 KB)… done
  ▶ python3 analyze.py  (+24 lines)
  ✓ rows: 2854, valid bills: 1561, voided: 17
  📁 saved output/revenue_by_weekday.png

Saturday is your strongest day (฿4,690 on average), almost double Monday (฿2,410).
Pork Katsu Curry earns the most money (฿33,600) even though Pork Curry Rice sells more plates…
```

Works with any data: POS exports, Google Sheets downloads, bank statements, stock lists, survey results.

## Setup (one time)

1. Get a Claude API key at https://platform.claude.com → *API Keys*.
2. Create **`.env`** in this folder:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
3. Dependencies are already installed. In a fresh copy, run `npm install`.

## Use it

1. Put your files in **`C:\Users\Dell\data-analyst\data\`**: `.csv`, `.xlsx`, `.xls`, `.json`, `.txt`.
   - Karena POS: **📊 Sales → Export Excel**, or Google Sheet **File → Download → Microsoft Excel**.
   - No data yet? `npm run sample-data` creates 8 weeks of made-up restaurant sales.
2. Run:
   ```powershell
   cd C:\Users\Dell\data-analyst
   node analyst.mjs
   ```
3. Ask anything, e.g.
   - "Give me an overview of this data"
   - "What are my busiest hours? Make a chart"
   - "Compare October with September"
   - "Which items are often bought together?"
   - "Predict next week's sales and explain how sure you are"
   - "Make an Excel file with monthly totals by category"

Charts (`.png`) and files (`.xlsx`, `.csv`, `.md`) appear in **`output\`**.

| Command | What it does |
|---|---|
| `/files` | List files in `data\` |
| `/load <file>` | Add a file you put in `data\` after starting |
| `/new` | Start a new conversation (re-attaches all files in `data\`) |
| `/cleanup` | Delete the uploaded copies of your files from Anthropic's servers |
| `/exit` | Quit (Ctrl+C stops an answer) |

## How it works

- At the start of a conversation, the files in `data\` are uploaded once (Anthropic Files API) and placed in a private
  Python sandbox. A file is only uploaded again if it changes.
- Claude explores the data, checks quality (blanks, duplicates, voided rows), calculates with code, and explains
  the results simply, including how confident it is.
- The sandbox is kept for the whole conversation, so follow-up questions are fast and can build on earlier work.
- You see each step as it runs: `▶` the code it runs, `✓` a short output, `📁` files saved to your computer.

## Settings (in `.env`)

```
ANALYST_MODEL=claude-opus-5-5   # default
ANALYST_EFFORT=high             # low | medium | high | xhigh | max (higher = more thorough, slower)
```

## Cost

Each answer shows a running estimate. A typical question costs about 5–20 US cents, depending on
how much code runs and how big the data is. The sandbox itself is free for normal use
(Anthropic includes many free hours each month).

## Privacy

- Your files are sent to Anthropic to be analysed. Uploaded copies stay in your Anthropic account until you
  delete them: run `/cleanup` when you're done with sensitive data.
- Remove personal details (customer names, phone numbers) from files if the analysis doesn't need them.
- `data\`, `output\` and `.uploads.json` are excluded from git.
