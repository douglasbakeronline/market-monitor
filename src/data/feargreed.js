// CNN Fear & Greed Index: current score, comparisons, the seven components and
// daily history. CNN stamps each daily point at 00:00 UTC, so dates are taken
// in UTC (converting to New York time shifted every day back by one).
import { fetchJson } from "./http.js";
import { utcDate } from "../util.js";

const BASE = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";

const COMPONENTS = {
  market_momentum_sp500: "Market momentum",
  stock_price_strength: "Stock price strength",
  stock_price_breadth: "Stock price breadth",
  put_call_options: "Put/call options",
  market_volatility_vix: "Market volatility",
  safe_haven_demand: "Safe-haven demand",
  junk_bond_demand: "Junk bond demand",
};

// One point per UTC date; the latest intraday reading wins.
export function dailyHistory(points) {
  const byDate = new Map();
  for (const p of points || []) {
    if (!Number.isFinite(p?.y)) continue;
    byDate.set(utcDate(p.x), { date: utcDate(p.x), t: p.x, y: Math.round(p.y) });
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function fetchFearGreed(startDate) {
  const data = await fetchJson(startDate ? `${BASE}/${startDate}` : BASE, { headers: { accept: "application/json" }, tries: 3 });
  const fg = data.fear_and_greed;
  if (!fg || !Number.isFinite(fg.score)) throw new Error("Fear & Greed payload missing score");
  const components = Object.entries(COMPONENTS)
    .filter(([k]) => data[k] && Number.isFinite(data[k].score))
    .map(([k, label]) => ({ key: k, label, score: Math.round(data[k].score), rating: data[k].rating }));
  return {
    score: Math.round(fg.score),
    rating: fg.rating,
    asOf: fg.timestamp,
    comparisons: {
      close: Math.round(fg.previous_close), week: Math.round(fg.previous_1_week),
      month: Math.round(fg.previous_1_month), year: Math.round(fg.previous_1_year),
    },
    components,
    history: dailyHistory(data.fear_and_greed_historical?.data),
  };
}

export function ratingFor(s) {
  if (s <= 24) return "extreme fear";
  if (s <= 44) return "fear";
  if (s <= 55) return "neutral";
  if (s <= 75) return "greed";
  return "extreme greed";
}
