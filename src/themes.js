// Themes tracked on the Trends page. Each theme has a benchmark ETF (where a
// liquid one exists) and a list of leading companies. Edit freely.
export const THEMES = [
  { key: "ai-chips", name: "AI chips and semiconductors", etf: "SMH", note: "The picks and shovels of AI: GPUs, custom chips, memory, chip-making equipment.",
    stocks: ["NVDA", "AVGO", "AMD", "TSM", "ASML", "MU", "ARM", "QCOM", "MRVL", "AMAT", "LRCX", "INTC"] },
  { key: "ai-platforms", name: "AI platforms and mega-cap tech", etf: "QQQ", note: "The giants building and selling AI: cloud, models, devices and ads.",
    stocks: ["MSFT", "GOOGL", "AMZN", "META", "AAPL", "ORCL", "TSLA", "IBM"] },
  { key: "ai-software", name: "AI software and data", etf: "IGV", note: "Software companies selling AI to businesses and governments.",
    stocks: ["PLTR", "CRM", "NOW", "SNOW", "ADBE", "DDOG", "MDB", "INTU", "SHOP", "APP"] },
  { key: "ai-infra", name: "AI infrastructure and power", etf: "GRID", note: "Data centres need servers, networking, cooling and electricity.",
    stocks: ["ANET", "SMCI", "DELL", "VRT", "ETN", "CEG", "VST", "GEV", "EQIX", "DLR"] },
  { key: "cyber", name: "Cybersecurity", etf: "CIBR", note: "Protecting networks and data; spending tends to grow in good times and bad.",
    stocks: ["CRWD", "PANW", "FTNT", "ZS", "NET", "OKTA"] },
  { key: "growth-consumer", name: "Consumer and fintech growth", etf: "ARKK", note: "Fast-growing consumer, payments and platform businesses.",
    stocks: ["NFLX", "UBER", "ABNB", "SPOT", "MELI", "COIN", "HOOD", "XYZ", "RBLX", "DUOL"] },
  { key: "space-defence", name: "Space and defence", etf: "ITA", note: "Defence budgets and the commercial space race.",
    stocks: ["SPCX", "RKLB", "LMT", "RTX", "NOC", "GD", "BA.L", "RR.L"] },
  { key: "health-innovation", name: "Healthcare innovation", etf: "XBI", note: "Obesity drugs, biotech and medical technology.",
    stocks: ["LLY", "NVO", "ISRG", "VRTX", "REGN", "AZN.L"] },
];
export const BENCHMARK = "^GSPC";
