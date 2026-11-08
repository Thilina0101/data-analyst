/**
 * Creates data/sample-karena-sales.csv: 8 weeks of made-up restaurant sales (one row per item sold)
 * so you can try the analyst before using real data.   npm run sample-data
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MENU = [
  ["Japanese Curry & Rice (Pork)", 49, "Rice", 30], ["Japanese Curry & Rice (Chicken)", 49, "Rice", 22],
  ["Pork Katsu Curry", 89, "Rice", 18], ["Chicken Katsu Curry", 85, "Rice", 14], ["Beef Curry", 99, "Rice", 6],
  ["Cheese Topping", 20, "Extras", 10], ["Extra Rice", 10, "Extras", 12], ["Fried Egg", 10, "Extras", 9],
  ["Thai Iced Tea", 30, "Drinks", 15], ["Green Tea", 25, "Drinks", 8], ["Water Bottle", 10, "Drinks", 11],
];
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = () => { const t = MENU.reduce((s, m) => s + m[3], 0); let x = rand() * t; for (const m of MENU) if ((x -= m[3]) < 0) return m; return MENU[0]; };

const rows = [["date", "time", "bill_no", "order_type", "payment", "item", "category", "qty", "unit_price", "amount", "status"]];
const start = Date.UTC(2026, 8, 14);
for (let d = 0; d < 56; d++) {
  const day = new Date(start + d * 86400000);
  const wd = day.getUTCDay();
  if (wd === 0) continue;                                         // closed Sundays
  const date = day.toISOString().slice(0, 10);
  // A rainy-season dip in late September and a Friday/Saturday rush.
  const base = { 1: 28, 2: 24, 3: 26, 4: 30, 5: 42, 6: 48 }[wd] * (d < 14 ? 0.85 : 1);
  const orders = Math.round(base * (0.85 + rand() * 0.3));
  for (let o = 1; o <= orders; o++) {
    const hour = rand() < 0.55 ? 11 + Math.floor(rand() * 3) : 17 + Math.floor(rand() * 3);
    const time = `${String(hour).padStart(2, "0")}:${String(Math.floor(rand() * 60)).padStart(2, "0")}`;
    const bill = `ORD-${date.replaceAll("-", "")}-${String(o).padStart(4, "0")}`;
    const type = rand() < 0.7 ? "Dine-in" : "Takeaway";
    const pay = rand() < 0.6 ? "Cash" : rand() < 0.85 ? "PromptPay" : "Card";
    const status = rand() < 0.01 ? "VOID" : "OK";
    const lines = new Map();
    for (let i = 0, n = 1 + Math.floor(rand() * 3); i < n; i++) { const m = pick(); lines.set(m, (lines.get(m) || 0) + 1); }
    for (const [m, qty] of lines) rows.push([date, time, bill, type, pay, m[0], m[2], qty, m[1], m[1] * qty, status]);
  }
}
const csv = rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n");
fs.mkdirSync(path.join(HERE, "data"), { recursive: true });
fs.writeFileSync(path.join(HERE, "data", "sample-karena-sales.csv"), csv + "\n");
console.log(`Created data/sample-karena-sales.csv (${rows.length - 1} rows, 8 weeks from 14 Sep 2026)`);
