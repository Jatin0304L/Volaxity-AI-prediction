
"use strict";

const STOCKS = [
  ["Reliance Industries", "RELIANCE.BSE"],
  ["TCS", "TCS.BSE"],
  ["Infosys", "INFY.BSE"],
  ["HDFC Bank", "HDFCBANK.BSE"],
  ["ICICI Bank", "ICICIBANK.BSE"],
  ["Bharti Airtel", "BHARTIARTL.BSE"],
  ["ITC", "ITC.BSE"],
  ["Hindustan Unilever", "HINDUNILVR.BSE"],
  ["Larsen & Toubro", "LT.BSE"],
  ["State Bank of India", "SBIN.BSE"],
  ["Wipro", "WIPRO.BSE"],
  ["Axis Bank", "AXISBANK.BSE"],
  ["Kotak Mahindra Bank", "KOTAKBANK.BSE"],
  ["Maruti Suzuki", "MARUTI.BSE"],
  ["Tata Motors", "TATAMOTORS.BSE"],
  ["Sun Pharma", "SUNPHARMA.BSE"],
  ["Titan", "TITAN.BSE"],
  ["Bajaj Finance", "BAJFINANCE.BSE"],
  ["Asian Paints", "ASIANPAINT.BSE"],
  ["NTPC", "NTPC.BSE"]
];

// Stock symbols are candidates.
// Actual API availability depends on the provider.

const $ = id => document.getElementById(id);

const fmt = (n, d = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-IN", {
        minimumFractionDigits: d,
        maximumFractionDigits: d
      })
    : "—";

let apiKey = "";
let current = STOCKS[0][1];
let cache = new Map();
let charts = {};
let alertThreshold = 2.5;

// API LIMIT MANAGEMENT

const DAILY_LIMIT = 25;
const MIN_INTERVAL_MS = 1500;

let lastRequestAt = 0;
let requestQueue = Promise.resolve();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

function usageKey() {
  const today = new Date().toLocaleDateString("en-CA");
  return "volatix-usage-" + today;
}

function usage() {
  return Number(localStorage.getItem(usageKey()) || 0);
}

function apiRequest(params) {
  const task = requestQueue.then(async () => {
    if (!apiKey) {
      throw Error("Enter your Alpha Vantage API key.");
    }

    if (usage() >= DAILY_LIMIT) {
      throw Error(
        "Daily API budget reached. Try again tomorrow or use cached data."
      );
    }

    const wait = Math.max(
      0,
      MIN_INTERVAL_MS - (Date.now() - lastRequestAt)
    );

    if (wait) await sleep(wait);

    lastRequestAt = Date.now();

    const url =
      "https://www.alphavantage.co/query?" +
      new URLSearchParams({
        ...params,
        apikey: apiKey
      });

    localStorage.setItem(
      usageKey(),
      String(usage() + 1)
    );

    const response = await fetch(url);

    if (!response.ok) {
      throw Error("HTTP error: " + response.status);
    }

    const json = await response.json();

    if (json.Note || json.Information) {
      throw Error(json.Note || json.Information);
    }

    if (json["Error Message"]) {
      throw Error(json["Error Message"]);
    }

    return json;
  });

  requestQueue = task.catch(() => {});
  return task;
}

// CACHE

function cacheKey(symbol) {
  return "volatix-stock-" + symbol;
}

function readSaved(symbol) {
  try {
    const obj = JSON.parse(
      localStorage.getItem(cacheKey(symbol)) || "null"
    );

    if (
      obj &&
      Date.now() - obj.savedAt < 6 * 60 * 60 * 1000 &&
      Array.isArray(obj.rows)
    ) {
      return obj.rows;
    }
  } catch (e) {
    console.warn("Cache read error:", e);
  }

  return null;
}

// HELPERS

function nameOf(symbol) {
  return STOCKS.find(x => x[1] === symbol)?.[0] || symbol;
}

function setText(id, value) {
  $(id).textContent = value;
}

function notice(message) {
  $("notice").textContent = message;
  $("notice").style.display = "block";
}

function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function sd(arr) {
  if (arr.length < 2) return NaN;

  const m = mean(arr);

  return Math.sqrt(
    arr.reduce((sum, x) => sum + (x - m) ** 2, 0) /
    (arr.length - 1)
  );
}

function returns(rows) {
  return rows
    .slice(1)
    .map((row, i) =>
      Math.log(row.close / rows[i].close)
    )
    .filter(Number.isFinite);
}

// EWMA VOLATILITY FORECAST

function forecast(r) {
  if (r.length < 5) return NaN;

  const lambda = 0.94;

  let variance = mean(
    r.slice(0, Math.min(15, r.length))
      .map(x => x * x)
  );

  for (const x of r) {
    variance =
      lambda * variance +
      (1 - lambda) * x * x;
  }

  return Math.sqrt(variance) * 100;
}

function hist(r, n = 30) {
  return sd(r.slice(-n)) * Math.sqrt(252) * 100;
}

function risk(v) {
  if (v < 1) return "Low";
  if (v < 2.5) return "Moderate";
  return "High";
}

function showError(error) {
  notice(
    "Data error: " + error.message +
    " Check API key, symbol, quota and internet."
  );
}

// FETCH STOCK DATA

async function getStock(symbol) {
  if (cache.has(symbol)) {
    return cache.get(symbol);
  }

  const saved = readSaved(symbol);

  if (saved) {
    cache.set(symbol, saved);
    return saved;
  }

  const json = await apiRequest({
    function: "TIME_SERIES_DAILY",
    symbol,
    outputsize: "compact"
  });

  const data = json["Time Series (Daily)"];

  if (!data) {
    throw Error(
      "No stock data returned for " + symbol +
      ". Check API plan or symbol support."
    );
  }

  const rows = Object.entries(data)
    .map(([date, value]) => ({
      date,
      close: Number(value["4. close"])
    }))
    .filter(x =>
      Number.isFinite(x.close) && x.close > 0
    )
    .sort((a, b) =>
      a.date.localeCompare(b.date)
    );

  if (rows.length < 10) {
    throw Error("Not enough historical stock data.");
  }

  cache.set(symbol, rows);

  try {
    localStorage.setItem(
      cacheKey(symbol),
      JSON.stringify({
        savedAt: Date.now(),
        rows
      })
    );
  } catch (e) {
    console.warn("Cache storage unavailable:", e);
  }

  return rows;
}

// CHARTS

function plot(id, labels, datasets, type = "line") {
  if (!window.Chart) return;

  charts[id]?.destroy();

  charts[id] = new Chart($(id), {
    type,
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false
      },
      plugins: {
        legend: {
          display: datasets.length > 1,
          position: "bottom"
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            maxTicksLimit: 7,
            color: "#a0aba5"
          }
        },
        y: {
          grid: { color: "#edf1ee" },
          ticks: { color: "#a0aba5" }
        }
      }
    }
  });
}

function line(label, data, color = "#0aab7d") {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color + "18",
    fill: false,
    tension: 0.25,
    pointRadius: 0,
    borderWidth: 2
  };
}

// LOAD DASHBOARD

async function load() {
  try {
    setText("lastPrice", "Loading...");

    const rows = await getStock(current);

    render(rows);

    $("notice").style.display = "none";

    $("apiStatus").textContent = "● API connected";
    $("apiStatus").classList.add("ready");

  } catch (error) {
    setText("lastPrice", "—");
    showError(error);
  }
}

function render(rows) {
  const r = returns(rows);

  const last = rows.at(-1);
  const prev = rows.at(-2);

  const change =
    (last.close / prev.close - 1) * 100;

  const predicted = forecast(r);
  const historical = hist(r);

  const dailyVol = sd(r.slice(-20)) * 100;

  setText("stockName", nameOf(current));
  setText("lastPrice", "₹" + fmt(last.close));

  setText(
    "dailyChange",
    (change >= 0 ? "+" : "") +
    fmt(change) + "% vs previous session"
  );

  $("dailyChange").className =
    "metric-foot " +
    (change >= 0 ? "positive" : "negative");

  setText("histVol", fmt(historical) + "%");
  setText("forecastValue", fmt(predicted) + "%");
  setText("riskLevel", risk(predicted));
  setText("dailyReturn", fmt(change) + "%");
  setText("dailyVol", fmt(dailyVol) + "%");
  setText("latestDate", last.date);
  setText("pointCount", rows.length);

  $("riskFill").style.left =
    Math.min(98, predicted / 5 * 100) + "%";

  setText(
    "chartTitle",
    nameOf(current) + " · Price history"
  );

  const n = Number($("rangeSelect").value);
  const subset = rows.slice(-n);

  plot(
    "priceChart",
    subset.map(x => x.date),
    [
      line(
        "Close price",
        subset.map(x => x.close)
      )
    ]
  );

  const message =
    predicted >= alertThreshold
      ? "⚠ Forecast volatility " +
        fmt(predicted) +
        "% exceeds your threshold."
      : "Forecast is below the selected alert threshold.";

  setText("alertMessage", message);

  renderForecast(r);
  renderBacktest(rows);
  renderReport(rows, r);
}

// FUTURE VOLATILITY

function renderForecast(r) {
  const v = forecast(r);

  $("forecastCards").innerHTML =
    [1, 7, 30].map(n => `
      <div class="mini-stat">
        <span>${n}-session expected volatility</span>
        <strong>${fmt(v * Math.sqrt(n))}%</strong>
        <small class="muted">
          ${n === 1
            ? "EWMA daily forecast"
            : "Square-root-of-time approximation"}
        </small>
      </div>
    `).join("");

  const windowReturns = r.slice(-45);

  const vol = windowReturns.map((_, i) =>
    i < 5
      ? null
      : sd(
          windowReturns.slice(
            Math.max(0, i - 19),
            i + 1
          )
        ) * 100
  );

  plot(
    "volChart",
    windowReturns.map(
      (_, i) => "T-" + (windowReturns.length - i)
    ),
    [
      line("Realized daily volatility %", vol)
    ]
  );
}

// PREDICTION BACKTEST

function renderBacktest(rows) {
  const r = returns(rows);

  const predicted = [];
  const actual = [];
  const labels = [];

  for (let i = 22; i < r.length; i++) {
    predicted.push(forecast(r.slice(0, i)));
    actual.push(Math.abs(r[i]) * 100);
    labels.push(rows[i + 1].date);
  }

  const errors = predicted.map(
    (x, i) => Math.abs(x - actual[i])
  );

  const mae = errors.length
    ? mean(errors)
    : NaN;

  const rmse = errors.length
    ? Math.sqrt(
        mean(errors.map(x => x * x))
      )
    : NaN;

  $("backtestStats").innerHTML = `
    <div class="mini-stat">
      <span>Backtest samples</span>
      <strong>${predicted.length}</strong>
    </div>
    <div class="mini-stat">
      <span>MAE (percentage points)</span>
      <strong>${fmt(mae)}</strong>
    </div>
    <div class="mini-stat">
      <span>RMSE (percentage points)</span>
      <strong>${fmt(rmse)}</strong>
    </div>
  `;

  plot(
    "backtestChart",
    labels,
    [
      line("Predicted daily σ %", predicted),
      line(
        "Next-session |return| %",
        actual,
        "#e65d6c"
      )
    ]
  );
}

// ANALYSIS REPORT

function renderReport(rows, r) {
  const last = rows.at(-1);
  const predicted = forecast(r);

  $("reportPreview").innerHTML = `
    <h2>VOLATIX AI · Stock Analysis</h2>

    <p><b>Company:</b> ${nameOf(current)} (${current})</p>
    <p><b>Latest date:</b> ${last.date}</p>
    <p><b>Last close:</b> ₹${fmt(last.close)}</p>

    <p>
      <b>Historical annualized volatility:</b>
      ${fmt(hist(r))}%
    </p>

    <p>
      <b>Next-day forecast daily volatility:</b>
      ${fmt(predicted)}%
    </p>

    <p><b>Risk category:</b> ${risk(predicted)}</p>
    <p><b>Observations:</b> ${rows.length}</p>

    <p>
      <small>
        Educational estimates. Source: Alpha Vantage.
        Not investment advice.
      </small>
    </p>
  `;
}

// COMPANY SELECTORS

function populate() {
  for (const id of [
    "stockSelect",
    "compareA",
    "compareB",
    "portfolioStock"
  ]) {
    $(id).innerHTML = STOCKS.map(
      ([name, symbol]) =>
        `<option value="${symbol}">${name}</option>`
    ).join("");
  }

  $("compareB").selectedIndex = 1;
}

// NAVIGATION

function navigate(page) {
  document.querySelectorAll(".page").forEach(
    element => {
      element.classList.toggle(
        "active",
        element.id === page
      );
    }
  );

  document.querySelectorAll(".nav-item").forEach(
    element => {
      element.classList.toggle(
        "active",
        element.dataset.page === page
      );
    }
  );

  const titles = {
    overview: "Overview",
    forecast: "Volatility forecasts",
    compare: "Compare stocks",
    portfolio: "Virtual portfolio",
    news: "News sentiment",
    history: "History & backtest",
    reports: "Analysis reports",
    settings: "API settings"
  };

  setText("pageTitle", titles[page]);
  setText("crumb", page.toUpperCase());

  $("subtitle").textContent =
    page === "overview"
      ? "Your stock market intelligence, all in one place."
      : "Explore insights and market analytics.";

  document.querySelector(".sidebar")
    .classList.remove("open");

  Object.values(charts).forEach(
    chart => chart.resize()
  );
}

// COMPARE TWO STOCKS

async function compare() {
  try {
    const a = $("compareA").value;
    const b = $("compareB").value;

    if (a === b) {
      throw Error("Select two different companies.");
    }

    // Sequential calls help respect API pacing.
    const ra = await getStock(a);
    const rb = await getStock(b);

    const xa = returns(ra);
    const xb = returns(rb);

    $("comparisonResult").innerHTML =
      [
        [a, ra, xa],
        [b, rb, xb]
      ].map(([symbol, rows, r]) => `
        <div class="compare-tile">
          <span>${nameOf(symbol)}</span>
          <strong>₹${fmt(rows.at(-1).close)}</strong>

          <div>
            Annualized volatility:
            <b>${fmt(hist(r))}%</b>
          </div>

          <div>
            Next-day forecast:
            <b>${fmt(forecast(r))}%</b>
          </div>
        </div>
      `).join("");

    const A = ra.slice(-30);
    const B = rb.slice(-30);

    const dates = A.map(x => x.date)
      .filter(date =>
        B.some(y => y.date === date)
      );

    if (dates.length < 2) {
      throw Error("No overlapping dates.");
    }

    const mapA = new Map(
      A.map(x => [x.date, x.close])
    );

    const mapB = new Map(
      B.map(x => [x.date, x.close])
    );

    plot(
      "compareChart",
      dates,
      [
        line(
          nameOf(a),
          dates.map(date =>
            (mapA.get(date) /
              mapA.get(dates[0]) - 1) * 100
          )
        ),
        line(
          nameOf(b),
          dates.map(date =>
            (mapB.get(date) /
              mapB.get(dates[0]) - 1) * 100
          ),
          "#e65d6c"
        )
      ]
    );

  } catch (error) {
    $("comparisonResult").textContent =
      error.message;
  }
}

// VIRTUAL PORTFOLIO

async function simulate() {
  try {
    const rows = await getStock(
      $("portfolioStock").value
    );

    const n = Number($("portfolioDays").value);
    const amount = Number($("investment").value);

    if (!(amount > 0)) {
      throw Error("Enter a positive amount.");
    }

    if (rows.length <= n) {
      throw Error("Not enough historical sessions.");
    }

    const start = rows.at(-n - 1);
    const end = rows.at(-1);

    const value =
      amount * end.close / start.close;

    const pnl = value - amount;

    $("portfolioResult").innerHTML = `
      <div class="compare-tile">
        <span>Starting simulated investment</span>
        <strong>₹${fmt(amount)}</strong>
        <small>${start.date}</small>
      </div>

      <div class="compare-tile">
        <span>Historical ending value</span>

        <strong class="${pnl >= 0
          ? "positive"
          : "negative"}">
          ₹${fmt(value)}
        </strong>

        <small>
          P/L: ${pnl >= 0 ? "+" : ""}
          ₹${fmt(pnl)}
          (${fmt(pnl / amount * 100)}%)
          · ${end.date}
        </small>
      </div>
    `;

  } catch (error) {
    $("portfolioResult").textContent =
      error.message;
  }
}

// NEWS SENTIMENT

async function fetchNews() {
  try {
    $("newsResult").textContent =
      "Loading news...";

    const data = await apiRequest({
      function: "NEWS_SENTIMENT",
      tickers: current,
      limit: "10"
    });

    if (
      !Array.isArray(data.feed) ||
      !data.feed.length
    ) {
      throw Error(
        "No news returned for this ticker or API plan."
      );
    }

    $("newsResult").replaceChildren();

    for (const item of data.feed) {
      const div = document.createElement("div");
      div.className = "news-item";

      const a = document.createElement("a");
      a.textContent =
        item.title || "Untitled article";

      if (/^https:\/\//.test(item.url || "")) {
        a.href = item.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
      }

      const meta = document.createElement("small");

      meta.textContent =
        (item.source || "Unknown source") +
        " · " +
        (item.overall_sentiment_label || "Unrated");

      div.append(a, meta);
      $("newsResult").append(div);
    }

  } catch (error) {
    $("newsResult").textContent =
      error.message;
  }
}

// INITIALIZE APPLICATION

document.addEventListener("DOMContentLoaded", () => {
  populate();

  setText(
    "today",
    new Date().toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    })
  );

  document.querySelectorAll("[data-page]")
    .forEach(element => {
      element.addEventListener("click", () =>
        navigate(element.dataset.page)
      );
    });

  document.querySelectorAll("[data-goto]")
    .forEach(element => {
      element.addEventListener("click", () =>
        navigate(element.dataset.goto)
      );
    });

  $("mobileMenu").onclick = () =>
    document.querySelector(".sidebar")
      .classList.toggle("open");

  $("noticeSettings").onclick = () =>
    navigate("settings");

  // SAVE API KEY

  $("saveKey").onclick = () => {
    apiKey = $("apiKey").value.trim();

    if (!apiKey) {
      notice("Enter an API key.");
      return;
    }

    cache.clear();

    for (const [, symbol] of STOCKS) {
      localStorage.removeItem(cacheKey(symbol));
    }

    $("apiKey").value = "";

    $("apiStatus").textContent =
      "● Key set · not verified";

    navigate("overview");
    load();
  };

  $("loadBtn").onclick = load;

  $("refreshBtn").onclick = () => {
    cache.delete(current);
    localStorage.removeItem(cacheKey(current));
    load();
  };

  $("stockSelect").onchange = event => {
    current = event.target.value;
    load();
  };

  $("rangeSelect").onchange = () => {
    if (cache.has(current)) {
      render(cache.get(current));
    }
  };

  $("compareBtn").onclick = compare;
  $("simulateBtn").onclick = simulate;
  $("newsBtn").onclick = fetchNews;

  $("printBtn").onclick = () => {
    navigate("reports");
    window.print();
  };

  $("saveAlert").onclick = () => {
    const value = Number(
      $("alertThreshold").value
    );

    if (value > 0) {
      alertThreshold = value;

      if (cache.has(current)) {
        render(cache.get(current));
      }
    }
  };

  // SEARCH STOCKS

  $("search").oninput = event => {
    const query =
      event.target.value.toLowerCase().trim();

    const matches = query
      ? STOCKS.filter(([name, symbol]) =>
          (name + " " + symbol)
            .toLowerCase()
            .includes(query)
        ).slice(0, 8)
      : [];

    $("searchResults").replaceChildren();

    for (const [name, symbol] of matches) {
      const button = document.createElement("button");

      button.textContent =
        name + " · " + symbol;

      button.onclick = () => {
        current = symbol;
        $("stockSelect").value = symbol;
        $("search").value = "";

        $("searchResults").style.display =
          "none";

        navigate("overview");
        load();
      };

      $("searchResults").append(button);
    }

    $("searchResults").style.display =
      matches.length ? "block" : "none";
  };

  document.addEventListener("keydown", event => {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.key.toLowerCase() === "k"
    ) {
      event.preventDefault();
      $("search").focus();
    }
  });
});
