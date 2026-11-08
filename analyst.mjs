#!/usr/bin/env node
/**
 * data-analyst — an AI data analyst in your terminal, powered by Claude.
 *
 *   node analyst.mjs
 *
 * Put CSV / Excel / JSON files in data/. Claude analyses them by writing and running real Python
 * (pandas, matplotlib) in Anthropic's secure code-execution sandbox, so numbers come from actual
 * calculations. Charts and files it creates are downloaded to output/.
 */
import Anthropic, { toFile } from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

/* ---------------------------------------------------------------- config */
const HERE = path.dirname(fileURLToPath(import.meta.url));
try { process.loadEnvFile(path.join(HERE, ".env")); } catch { /* no .env file is fine */ }

const MODEL = process.env.ANALYST_MODEL || "claude-opus-5-5";
const EFFORT = process.env.ANALYST_EFFORT || "high";                 // low | medium | high | xhigh | max
const DATA_DIR = path.join(HERE, "data");
const OUTPUT_DIR = path.join(HERE, "output");
const CACHE_FILE = path.join(HERE, ".uploads.json");                 // local file → uploaded file_id
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"]);
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };  // approx. Claude Opus 5.5, $ per million tokens
const MIME = {
  ".csv": "text/csv", ".tsv": "text/tab-separated-values", ".txt": "text/plain", ".json": "application/json", ".xml": "application/xml",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".xls": "application/vnd.ms-excel",
};

const c = (code) => (s) => `\x1b[${code}m${s}\x1b[0m`;
const dim = c(2), red = c(31), green = c(32), yellow = c(33), cyan = c(36), bold = c(1);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };

/* ---------------------------------------------------------------- files */
const client = new Anthropic();

function dataFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  return fs.readdirSync(DATA_DIR).filter((f) => MIME[path.extname(f).toLowerCase()] && !f.startsWith("~$")).sort();
}

// Upload a local file once; reuse the file_id while the file is unchanged.
async function upload(name) {
  const file = path.join(DATA_DIR, path.basename(name));
  if (!fs.existsSync(file)) throw new Error(`${name} is not in the data folder`);
  const buf = fs.readFileSync(file);
  const hash = crypto.createHash("sha256").update(buf).digest("hex");
  const cache = readJson(CACHE_FILE, {});
  const hit = cache[hash];
  if (hit) {
    try { await client.files.retrieveMetadata(hit.id); return hit.id; } catch { /* deleted on the server: upload again */ }
  }
  process.stdout.write(dim(`  ⬆ uploading ${path.basename(file)} (${Math.ceil(buf.length / 1024)} KB)… `));
  const meta = await client.files.upload({ file: await toFile(buf, path.basename(file), { type: MIME[path.extname(file).toLowerCase()] }) });
  console.log(dim("done"));
  cache[hash] = { id: meta.id, name: path.basename(file), uploaded: new Date().toISOString() };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  return meta.id;
}

// Find every file the sandbox produced (charts, Excel files…) anywhere in the response.
function outputFileIds(content) {
  const ids = [];
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") {
      if (typeof v.file_id === "string" && /output/.test(String(v.type))) ids.push(v.file_id);
      Object.values(v).forEach(walk);
    }
  };
  walk(content);
  return ids;
}

const downloaded = new Set();
async function downloadOutputs(content) {
  for (const id of outputFileIds(content)) {
    if (downloaded.has(id)) continue;
    downloaded.add(id);
    try {
      const meta = await client.files.retrieveMetadata(id);
      let name = path.basename(meta.filename || id).replace(/[^\p{L}\p{N}._ -]+/gu, "-");
      if (!name || name === "." || name === "..") name = id;
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      let target = path.join(OUTPUT_DIR, name);
      for (let i = 2; fs.existsSync(target); i++) target = path.join(OUTPUT_DIR, name.replace(/(\.[^.]*)?$/, `-${i}$1`));
      const res = await client.files.download(id);
      fs.writeFileSync(target, Buffer.from(await res.arrayBuffer()));
      console.log(green(`\n  📁 saved output/${path.basename(target)}`));
    } catch (e) {
      console.log(red(`\n  could not download a result file: ${e.message}`));
    }
  }
}

/* ---------------------------------------------------------------- prompt (fixed, so it caches) */
const SYSTEM = `You are a careful data analyst working with a small-business owner who is not a data expert.
You have a Python sandbox (code execution) with pandas, numpy, scipy, statsmodels, matplotlib and seaborn. The user's data files are uploaded into it.

How to work:
- Always compute numbers with code. Never estimate or do arithmetic in your head. Look at the data first (columns, types, row count, date range, missing values) before drawing conclusions.
- Check data quality and say what you found: duplicates, blanks, odd values, voided/cancelled rows, mixed date formats. State how you handled them.
- Answer the question first, in plain language with the key numbers, then the detail. Use simple words, not statistics jargon, and explain any metric you use.
- Say how confident you are and why (e.g. small sample, short period, outliers). Don't present correlation as cause.
- When a chart helps, make one with matplotlib: clear title, labelled axes with units, readable fonts, and no 3D or pie charts with many slices. Save it as a PNG file (dpi=150) with a descriptive file name. Thai text may not render in default fonts, so use English labels in charts.
- When the user asks for a table or report to keep, save it as a file (.xlsx or .csv for tables, .md for written reports).
- Every file you save is delivered to the user's computer automatically. Tell them the file name.
- If the data can't answer the question, say so and say what data would.
- Reply in the user's language.`;

/* ---------------------------------------------------------------- chat */
let messages = [], container = null, pendingFiles = [], current = null, interrupted = false, totalCost = 0;

async function attach(names) {
  const blocks = [];
  for (const n of names) blocks.push({ type: "container_upload", file_id: await upload(n) });
  return blocks;
}

async function respond() {
  while (true) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      system: SYSTEM,
      tools: [{ type: "code_execution_20260521", name: "code_execution" }],
      messages,
      ...(container ? { container } : {}),                   // keep the same sandbox (files, variables) all conversation
      thinking: { type: "adaptive" },
      output_config: { effort: EFFORT },
      cache_control: { type: "ephemeral" },
      ...(FALLBACK_MODELS.has(MODEL) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    });
    current = stream;
    const inputs = {};
    let message;
    try {
      for await (const ev of stream) {
        if (ev.type === "content_block_start") {
          const b = ev.content_block;
          if (b.type === "server_tool_use") inputs[ev.index] = "";
          else if (b.type === "text") process.stdout.write("\n");
          else if (b.type.endsWith("_tool_result")) showResult(b);
        } else if (ev.type === "content_block_delta") {
          if (ev.delta.type === "text_delta") process.stdout.write(ev.delta.text);
          else if (ev.delta.type === "input_json_delta" && ev.index in inputs) inputs[ev.index] += ev.delta.partial_json;
        } else if (ev.type === "content_block_stop" && ev.index in inputs) {
          showCode(inputs[ev.index]);
          delete inputs[ev.index];
        }
      }
      message = await stream.finalMessage();
    } catch (err) {
      if (interrupted) { interrupted = false; console.log(yellow("\n(stopped)")); return; }
      throw err;
    } finally {
      current = null;
    }

    if (message.container?.id) container = message.container.id;
    const u = message.usage;
    totalCost += (u.input_tokens * PRICE.input + u.output_tokens * PRICE.output
      + (u.cache_read_input_tokens || 0) * PRICE.cacheRead + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite) / 1e6;

    if (message.stop_reason === "refusal") { console.log(red("\nClaude declined this request. Try rephrasing it.")); return; }
    messages.push({ role: "assistant", content: message.content });     // append unchanged; never edit history
    await downloadOutputs(message.content);
    if (message.stop_reason === "pause_turn") continue;                   // long analysis: let it continue
    if (message.stop_reason === "max_tokens") console.log(yellow("\n(The answer hit the length limit. Ask it to continue.)"));
    console.log(dim(`\n\n  [session ≈ $${totalCost.toFixed(3)}]`));
    return;
  }
}

function showCode(json) {
  let input = {};
  try { input = JSON.parse(json || "{}"); } catch { /* partial */ }
  const code = input.command || input.code || input.file_text || input.path || "";
  const lines = String(code).trim().split("\n");
  console.log(dim(`\n  ▶ ${lines[0].slice(0, 110)}${lines.length > 1 ? `  (+${lines.length - 1} lines)` : ""}`));
}

function showResult(b) {
  const r = b.content || {};
  if (r.type?.endsWith("_error")) return console.log(red(`  ✗ ${r.error_code || "error"}`));
  if (typeof r.return_code === "number") {
    const out = String(r.return_code === 0 ? r.stdout || "" : r.stderr || r.stdout || "").trim().split("\n").slice(0, 3).join(" ⏎ ");
    console.log(r.return_code === 0 ? dim(`  ✓ ${out.slice(0, 140)}`) : red(`  ✗ exit ${r.return_code}: ${out.slice(0, 140)}`));
  }
}

/* ---------------------------------------------------------------- main */
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on("SIGINT", () => {
  if (current) { interrupted = true; current.abort(); return; }
  console.log("\nBye!"); process.exit(0);
});

function startConversation() {
  messages = []; container = null;
  pendingFiles = dataFiles();
}

console.log(bold(cyan("Data analyst")) + dim(` · ${MODEL} · effort ${EFFORT}`));
if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) console.log(yellow(`No ANTHROPIC_API_KEY found. Put it in ${path.join(HERE, ".env")} (see README.md).`));
startConversation();
console.log(dim(pendingFiles.length ? `Data files: ${pendingFiles.join(", ")}` : "No data files yet. Put CSV/Excel files in the data folder (or run: npm run sample-data)."));
console.log(dim(`Try: "Give me an overview of this data" · "Which items sell best on weekends? Make a chart"
Commands: /files, /load <file>, /new, /cleanup (delete uploaded copies), /exit\n`));

while (true) {
  let input;
  try { input = (await rl.question(bold(green("\n> ")))).trim(); } catch { break; }
  if (!input) continue;
  if (input === "/exit" || input === "/quit") break;
  if (input === "/new") { startConversation(); console.log(dim(`New conversation. Files: ${pendingFiles.join(", ") || "none"}`)); continue; }
  if (input === "/files") { console.log(dataFiles().map((f) => `  ${f}`).join("\n") || dim("  none")); continue; }
  if (input.startsWith("/load ")) {
    const name = input.slice(6).trim();
    if (!dataFiles().includes(name)) { console.log(red(`  ${name} isn't in the data folder.`)); continue; }
    pendingFiles.push(name); console.log(dim(`  ${name} will be added with your next message.`)); continue;
  }
  if (input === "/cleanup") {
    const cache = readJson(CACHE_FILE, {});
    for (const v of Object.values(cache)) { try { await client.files.delete(v.id); console.log(dim(`  deleted uploaded copy of ${v.name}`)); } catch { /* already gone */ } }
    fs.rmSync(CACHE_FILE, { force: true });
    startConversation();
    continue;
  }

  try {
    const content = [...(await attach(pendingFiles)), { type: "text", text: input }];
    pendingFiles = [];
    messages.push({ role: "user", content });
    await respond();
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.log(red("\nThe API key was rejected. Check ANTHROPIC_API_KEY in .env."));
    else if (err instanceof Anthropic.RateLimitError) console.log(red("\nRate limit reached. Wait a minute and try again."));
    else if (err instanceof Anthropic.BadRequestError) console.log(red(`\nRequest rejected: ${err.message}`));
    else if (err instanceof Anthropic.APIConnectionError) console.log(red("\nCould not reach the Claude API. Check the internet connection."));
    else if (err instanceof Anthropic.APIError) console.log(red(`\nAPI error ${err.status ?? ""}: ${err.message}`));
    else console.log(red(`\nError: ${err?.message || err}`));
  }
}
rl.close();
