const API_URL = "https://e-ckw-public-data.de-c1.eu1.cloudhub.io/api/v1/netzinformationen/energie/dynamische-preise";

const APPLIANCES = [
  {
    id: "ev",
    name: "Tesla Model Y (SR 2024)",
    description: "11 kW Wallbox, ca. 5 Stunden Ladezeit ≈ 55 kWh Energiebedarf.",
    durationMinutes: 300,
    energyKWh: 55,
    kmPerKWh: 6.5,
  },
  {
    id: "dryer",
    name: "Tumbler",
    description: "Standardprogramm Trocken (90 Minuten), typischer Verbrauch ≈ 2.4 kWh.",
    durationMinutes: 90,
    energyKWh: 2.4,
  },
  {
    id: "heat_pump",
    name: "Waermepumpe / Heizungsschub",
    description: "Booster-Lauf (120 Minuten) mit ca. 6 kWh Mehrbedarf.",
    durationMinutes: 120,
    energyKWh: 6,
  },
  {
    id: "water",
    name: "Boiler / Warmwasser",
    description: "60 Minuten Nachheizen des Boilers ≈ 3.5 kWh.",
    durationMinutes: 60,
    energyKWh: 3.5,
  },
];

const DEFAULT_BASELINE_RATE = 0.31; // CHF/kWh entspricht 31 Rp.
const DEMO_DATA = buildDemoData();
let currentBaselineRate = DEFAULT_BASELINE_RATE;
const LOAD_PROFILE_INTERVAL_MINUTES = 15;
const SLOT_INTERVAL_MS = LOAD_PROFILE_INTERVAL_MINUTES * 60 * 1000;
const currencyFormatter = new Intl.NumberFormat("de-CH", {
  style: "currency",
  currency: "CHF",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const percentFormatter = new Intl.NumberFormat("de-CH", {
  style: "percent",
  maximumFractionDigits: 1,
});
const numberFormatters = new Map();

let latestSlots = [];
let latestLoadProfile = [];
let latestLoadProfileMap = new Map();
let latestLoadProfileError = "";
let latestLoadProfileMeta = null;

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#query-form");
  const startInput = document.querySelector("#start");
  const endInput = document.querySelector("#end");
  const useDemoCheckbox = document.querySelector("#use-demo");
  const loadProfileInput = document.querySelector("#load-profile");
  const baselineRateInput = document.querySelector("#baseline-rate");

  const today = new Date();
  today.setMinutes(0, 0, 0);
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  startInput.value = toLocalDateTime(startOfDay);
  endInput.value = toLocalDateTime(endOfDay);
  if (baselineRateInput) {
    baselineRateInput.value = currentBaselineRate.toFixed(4);
    baselineRateInput.addEventListener("change", () => {
      const parsed = sanitizeNumber(baselineRateInput.value);
      if (Number.isFinite(parsed) && parsed >= 0) {
        currentBaselineRate = parsed;
      }
      baselineRateInput.value = currentBaselineRate.toFixed(4);
      if (latestSlots.length) {
        renderChart(latestSlots);
        renderComparison(latestSlots);
        renderTable(latestSlots);
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoadingState(true);

    const formData = new FormData(form);
    const params = Object.fromEntries(formData.entries());
    delete params.baseline_rate;
    if (baselineRateInput) {
      const parsedBaseline = sanitizeNumber(baselineRateInput.value);
      if (Number.isFinite(parsedBaseline) && parsedBaseline >= 0) {
        currentBaselineRate = parsedBaseline;
      }
      baselineRateInput.value = currentBaselineRate.toFixed(4);
    }
    const selectedFile = loadProfileInput?.files?.[0] || null;
    let loadProfileEntries = [];
    let loadProfileMeta = selectedFile ? { fileName: selectedFile.name } : null;
    let loadProfileError = "";

    try {
      if (selectedFile) {
        try {
          const parsed = await parseLoadProfileFile(selectedFile);
          loadProfileEntries = parsed.entries;
          loadProfileMeta = { ...loadProfileMeta, ...parsed.meta };
        } catch (profileError) {
          console.error("Lastgang konnte nicht gelesen werden", profileError);
          loadProfileError =
            profileError instanceof Error
              ? profileError.message
              : "Der Lastgang konnte nicht verarbeitet werden.";
        }
      }

      const tariffType = params.tariff_type || "integrated";
      const data = useDemoCheckbox.checked
        ? DEMO_DATA
        : await fetchTariffs(params);

      renderDashboard(
        data,
        tariffType,
        { entries: loadProfileEntries, meta: loadProfileMeta },
        loadProfileError
      );
    } catch (error) {
      console.error("Preisabfrage fehlgeschlagen", error);
      renderError(
        "Preisabfrage fehlgeschlagen. Demo-Daten koennen als Fallback genutzt werden."
      );
    } finally {
      setLoadingState(false);
    }
  });

  // Initial Demo-Ladung, damit sofort Inhalte sichtbar sind.
  renderDashboard(DEMO_DATA, "integrated");
});

function setLoadingState(isLoading) {
  const button = document.querySelector("#query-form button");
  button.disabled = isLoading;
  button.textContent = isLoading ? "Lade..." : "Preise laden";
}

async function fetchTariffs(params) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      if (key.endsWith("timestamp")) {
        url.searchParams.append(key, new Date(value).toISOString());
      } else {
        url.searchParams.append(key, value);
      }
    }
  });

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function renderDashboard(data, tariffType, loadProfileData = null, loadProfileError = "") {
  const slots = normalizeSlots(data, tariffType);

  if (!slots.length) {
    renderError("Keine Daten fuer den gewaehlten Zeitraum/Tariftyp gefunden.");
    return;
  }

  latestSlots = slots;
  latestLoadProfile = Array.isArray(loadProfileData?.entries)
    ? loadProfileData.entries
    : [];
  latestLoadProfileMap = buildLoadProfileMap(latestLoadProfile);
  latestLoadProfileError = loadProfileError || "";
  latestLoadProfileMeta = loadProfileData?.meta || null;

  renderRecommendations(slots);
  renderChart(slots);
  renderComparison(slots);
  renderTable(slots);
}

function renderError(message) {
  latestSlots = [];
  latestLoadProfile = [];
  latestLoadProfileMap = new Map();
  latestLoadProfileError = "";
  latestLoadProfileMeta = null;
  const recommendations = document.querySelector("#recommendations");
  const chart = document.querySelector("#chart");
  const tableBody = document.querySelector("#price-table tbody");
  const comparison = document.querySelector("#comparison");

  recommendations.innerHTML = `<div class="alert">${message}</div>`;
  chart.innerHTML = "";
  tableBody.innerHTML = "";
  if (comparison) {
    comparison.innerHTML = `<p class="comparison-empty">${message}</p>`;
  }
}

function normalizeSlots(payload, tariffType) {
  return payload
    .map((slot) => {
      const priceEntry = extractPrice(slot, tariffType);
      if (!priceEntry) return null;

      return {
        start: new Date(slot.start_timestamp || slot.startTimestamp),
        end: new Date(slot.end_timestamp || slot.endTimestamp),
        price: Number(priceEntry.value),
        unit: priceEntry.unit ? priceEntry.unit.replace(/_/g, "/") : "CHF/kWh",
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

function extractPrice(slot, tariffType) {
  if (slot[tariffType] && Array.isArray(slot[tariffType]) && slot[tariffType][0]) {
    return slot[tariffType][0];
  }

  // Wenn kein spezifischer Tarif angefragt wurde, alle durchsuchen
  const fallbackKeys = ["integrated", "grid", "grid_usage", "electricity"];
  for (const key of fallbackKeys) {
    if (slot[key] && Array.isArray(slot[key]) && slot[key][0]) {
      return slot[key][0];
    }
  }
  return null;
}

function buildLoadProfileMap(entries) {
  const map = new Map();
  if (!Array.isArray(entries)) {
    return map;
  }

  entries.forEach((entry) => {
    if (!entry || !(entry.start instanceof Date)) return;
    const key = toSlotKey(entry.start);
    if (key === null) return;
    const energy = Number(entry.energy);
    if (!Number.isFinite(energy)) return;
    map.set(key, (map.get(key) || 0) + energy);
  });

  return map;
}

function renderRecommendations(slots) {
  const container = document.querySelector("#recommendations");
  container.innerHTML = "";

  APPLIANCES.forEach((appliance) => {
    const recommendation = findCheapestWindow(slots, appliance.durationMinutes);
    if (!recommendation) return;

    const card = document.createElement("article");
    card.className = "recommendation-card";
    const unit = recommendation.unit || "CHF/kWh";
    const metaParts = [];

    if (appliance.energyKWh) {
      metaParts.push(
        `<span><strong>${appliance.energyKWh.toFixed(1)} kWh</strong> Bedarf</span>`
      );
      const estimatedCost = recommendation.averagePrice * appliance.energyKWh;
      metaParts.push(
        `<span><strong>${estimatedCost.toFixed(2)} CHF</strong> Energiekosten</span>`
      );
      if (appliance.kmPerKWh) {
        const estimatedRange = Math.round(appliance.energyKWh * appliance.kmPerKWh);
        metaParts.push(`<span><strong>${estimatedRange} km</strong> Reichweite</span>`);
      }
    }

    const metaHtml = metaParts.length ? `<div class="meta">${metaParts.join("")}</div>` : "";

    card.innerHTML = `
      <h3>${appliance.name}</h3>
      <div class="time">${formatRange(recommendation.start, recommendation.end)}</div>
      <div class="price">${recommendation.averagePrice.toFixed(4)} ${unit}</div>
      ${metaHtml}
      <p>${appliance.description}</p>
    `;
    container.appendChild(card);
  });

  if (!container.children.length) {
    container.innerHTML = "<p>Keine Empfehlungen verfuegbar.</p>";
  }
}

function findCheapestWindow(slots, durationMinutes) {
  if (!slots.length) return null;
  const unit = slots[0]?.unit || "CHF/kWh";
  const slotDuration = Math.max(
    1,
    Math.round((slots[0].end.getTime() - slots[0].start.getTime()) / 60000)
  );
  const windowSize = Math.max(1, Math.round(durationMinutes / slotDuration));

  if (windowSize > slots.length) {
    return null;
  }

  let best = null;
  let currentSum = 0;

  for (let i = 0; i < slots.length; i += 1) {
    currentSum += slots[i].price;

    if (i >= windowSize) {
      currentSum -= slots[i - windowSize].price;
    }

    if (i >= windowSize - 1) {
      const average = currentSum / windowSize;
      if (!best || average < best.averagePrice) {
        best = {
          start: slots[i - windowSize + 1].start,
          end: slots[i].end,
          averagePrice: average,
          unit,
        };
      }
    }
  }

  return best;
}

function renderChart(slots) {
  const chart = document.querySelector("#chart");
  chart.innerHTML = "";

  if (!slots.length) {
    return;
  }

  const unit = (slots[0]?.unit || "CHF/kWh").replace(/_/g, "/");
  const prices = slots.map((slot) => slot.price);
  const minSlot = slots.reduce(
    (lowest, current) => (current.price < lowest.price ? current : lowest),
    slots[0]
  );
  const maxSlot = slots.reduce(
    (highest, current) => (current.price > highest.price ? current : highest),
    slots[0]
  );
  const averagePrice = prices.reduce((sum, value) => sum + value, 0) / prices.length;
  const firstSlot = slots[0];
  const lastSlot = slots[slots.length - 1];
  const trendPercent =
    firstSlot && firstSlot.price
      ? ((lastSlot.price - firstSlot.price) / firstSlot.price) * 100
      : 0;
  const hasLoadProfile = latestLoadProfile.length > 0 && !latestLoadProfileError;
  const loadMultiplier = 60 / LOAD_PROFILE_INTERVAL_MINUTES;
  let loadSamplesCount = 0;
  let peakLoadPower = 0;
  let peakLoadSlot = null;
  let totalLoadEnergy = 0;
  const loadValues = slots.map((slot) => {
    const key = toSlotKey(slot.start);
    const energy = key !== null ? latestLoadProfileMap.get(key) : undefined;
    if (typeof energy === "number" && Number.isFinite(energy)) {
      const power = energy * loadMultiplier;
      loadSamplesCount += 1;
      totalLoadEnergy += energy;
      if (power > peakLoadPower) {
        peakLoadPower = power;
        peakLoadSlot = slot;
      }
      return { energy, power };
    }
    return { energy: null, power: 0 };
  });
  const hasLoadData = hasLoadProfile && loadSamplesCount > 0;
  const loadMaxPower = hasLoadData
    ? Math.max(...loadValues.map((entry) => entry.power))
    : 0;
  const loadAxisMax = hasLoadData
    ? loadMaxPower + Math.max(loadMaxPower * 0.2, 0.5)
    : 0;
  const loadAxisRange = loadAxisMax > 0 ? loadAxisMax : 1;

  const formatAxisLabel = (value) => {
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.1) return value.toFixed(3);
    return value.toFixed(4);
  };

  const buildMetric = (label, value, hint, modifier) => {
    const metric = document.createElement("div");
    metric.className = "chart-metric";
    if (modifier) {
      metric.classList.add(modifier);
    }
    metric.innerHTML = `
      <div class="chart-metric__label">${label}</div>
      <div class="chart-metric__value">${value}</div>
      ${hint ? `<div class="chart-metric__hint">${hint}</div>` : ""}
    `;
    return metric;
  };

  const summary = document.createElement("div");
  summary.className = "chart-summary";
  summary.appendChild(
    buildMetric(
      "Minimum",
      `${minSlot.price.toFixed(4)} ${unit}`,
      `${formatTime(minSlot.start)} – ${formatTime(minSlot.end)}`
    )
  );
  summary.appendChild(
    buildMetric(
      "Maximum",
      `${maxSlot.price.toFixed(4)} ${unit}`,
      `${formatTime(maxSlot.start)} – ${formatTime(maxSlot.end)}`
    )
  );
  summary.appendChild(
    buildMetric(
      "Durchschnitt",
      `${averagePrice.toFixed(4)} ${unit}`,
      `${slots.length} Slots`
    )
  );
  summary.appendChild(
    buildMetric(
      "Einheitstarif",
      formatPrice(currentBaselineRate),
      "Fixpreis Vergleich"
    )
  );
  const trendValue =
    Number.isFinite(trendPercent) && Math.abs(trendPercent) < 0.05
      ? "~0%"
      : `${trendPercent >= 0 ? "+" : ""}${trendPercent.toFixed(1)}%`;
  const trendModifier =
    Math.abs(trendPercent) < 0.05 ? null : trendPercent >= 0 ? "is-up" : "is-down";
  summary.appendChild(
    buildMetric(
      "Trend",
      trendValue,
      `${formatShortTime(firstSlot.start)} -> ${formatShortTime(lastSlot.end)}`,
      trendModifier
    )
  );
  if (hasLoadData) {
    summary.appendChild(
      buildMetric(
        "Lastgang-Spitze",
        `${formatKw(peakLoadPower)} kW`,
        peakLoadSlot
          ? `${formatTime(peakLoadSlot.start)} - ${formatTime(peakLoadSlot.end)}`
          : "",
        "is-load"
      )
    );
    summary.appendChild(
      buildMetric(
        "Lastgang Energie",
        `${formatNumber(totalLoadEnergy, 1)} kWh`,
        `${loadSamplesCount}/${slots.length} Slots`,
        "is-load"
      )
    );
  }
  chart.appendChild(summary);

  const containerWidth = chart.getBoundingClientRect().width || chart.clientWidth || 1200;
  const svgWidth = Math.max(containerWidth - 32, slots.length * 32 + 280, 1480);
  const svgHeight = 420;
  const topPadding = 40;
  const bottomPadding = 90;
  const leftPadding = 80;
  const rightPadding = hasLoadData ? 95 : 70;
  const drawableWidth = svgWidth - leftPadding - rightPadding;
  const drawableHeight = svgHeight - topPadding - bottomPadding;
  const svgNS = "http://www.w3.org/2000/svg";
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const paddedRange = (maxPrice - minPrice) * 0.2 || Math.max(maxPrice * 0.12, 0.02);
  let axisMin = Math.max(0, minPrice - paddedRange);
  let axisMax = maxPrice + paddedRange * 0.6;
  if (currentBaselineRate < axisMin) {
    axisMin = Math.max(0, currentBaselineRate - paddedRange * 0.5);
  }
  if (currentBaselineRate > axisMax) {
    axisMax = currentBaselineRate + paddedRange * 0.5;
  }
  const axisRange = axisMax - axisMin || axisMax || 1;
  const baselineWithinRange =
    currentBaselineRate >= axisMin && currentBaselineRate <= axisMax;
  const ySteps = 5;
  const denominator = Math.max(1, slots.length - 1);
  const baselineY = topPadding + drawableHeight;

  const points = slots.map((slot, index) => {
    const ratio = slots.length === 1 ? 0.5 : index / denominator;
    const x = leftPadding + ratio * drawableWidth;
    const normalized = Math.min(Math.max((slot.price - axisMin) / axisRange, 0), 1);
    const y = topPadding + (1 - normalized) * drawableHeight;
    return { slot, x, y, index };
  });

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  let areaPath = `M ${firstPoint.x} ${baselineY} L ${firstPoint.x} ${firstPoint.y}`;
  let linePath = `M ${firstPoint.x} ${firstPoint.y}`;
  points.slice(1).forEach((point) => {
    areaPath += ` L ${point.x} ${point.y}`;
    linePath += ` L ${point.x} ${point.y}`;
  });
  areaPath += ` L ${lastPoint.x} ${baselineY} Z`;

  const surface = document.createElement("div");
  surface.className = "chart-surface";

  const canvas = document.createElement("div");
  canvas.className = "chart-canvas";
  canvas.style.width = `${svgWidth}px`;
  surface.appendChild(canvas);

  const svg = document.createElementNS(svgNS, "svg");
  svg.classList.add("chart-svg");
  svg.setAttribute("viewBox", `0 0 ${svgWidth} ${svgHeight}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.width = `${svgWidth}px`;
  svg.style.height = `${svgHeight}px`;

  const defs = document.createElementNS(svgNS, "defs");
  const gradientId = `chart-gradient-${Math.random().toString(36).slice(2, 8)}`;
  const gradient = document.createElementNS(svgNS, "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y2", "1");

  const stopTop = document.createElementNS(svgNS, "stop");
  stopTop.setAttribute("offset", "0%");
  stopTop.setAttribute("stop-color", "rgba(0, 245, 212, 0.45)");

  const stopMid = document.createElementNS(svgNS, "stop");
  stopMid.setAttribute("offset", "55%");
  stopMid.setAttribute("stop-color", "rgba(123, 92, 255, 0.25)");

  const stopBottom = document.createElementNS(svgNS, "stop");
  stopBottom.setAttribute("offset", "100%");
  stopBottom.setAttribute("stop-color", "rgba(123, 92, 255, 0)");

  gradient.append(stopTop, stopMid, stopBottom);
  defs.appendChild(gradient);
  svg.appendChild(defs);

  if (hasLoadData) {
    const firstLoadNormalized = Math.min(Math.max(loadValues[0].power / loadAxisRange, 0), 1);
    const firstLoadY = topPadding + (1 - firstLoadNormalized) * drawableHeight;
    let loadAreaPath = `M ${firstPoint.x} ${baselineY} L ${firstPoint.x} ${firstLoadY}`;
    let loadLinePath = `M ${firstPoint.x} ${firstLoadY}`;
    for (let i = 1; i < points.length; i += 1) {
      const point = points[i];
      const loadNormalized = Math.min(
        Math.max(loadValues[i].power / loadAxisRange, 0),
        1
      );
      const yLoad = topPadding + (1 - loadNormalized) * drawableHeight;
      loadAreaPath += ` L ${point.x} ${yLoad}`;
      loadLinePath += ` L ${point.x} ${yLoad}`;
    }
    loadAreaPath += ` L ${lastPoint.x} ${baselineY} Z`;

    const loadArea = document.createElementNS(svgNS, "path");
    loadArea.classList.add("chart-load-area");
    loadArea.setAttribute("d", loadAreaPath);
    svg.appendChild(loadArea);

    const loadLine = document.createElementNS(svgNS, "path");
    loadLine.classList.add("chart-load-line");
    loadLine.setAttribute("d", loadLinePath);
    svg.appendChild(loadLine);
  }

  const priceArea = document.createElementNS(svgNS, "path");
  priceArea.classList.add("chart-area");
  priceArea.setAttribute("d", areaPath);
  priceArea.setAttribute("fill", `url(#${gradientId})`);
  svg.appendChild(priceArea);

  const priceLine = document.createElementNS(svgNS, "path");
  priceLine.classList.add("chart-line");
  priceLine.setAttribute("d", linePath);
  svg.appendChild(priceLine);

  if (baselineWithinRange) {
    const baselineRatio = Math.min(
      Math.max((currentBaselineRate - axisMin) / axisRange, 0),
      1
    );
    const baselineYCoord = topPadding + (1 - baselineRatio) * drawableHeight;
    const baselineLine = document.createElementNS(svgNS, "line");
    baselineLine.classList.add("chart-baseline");
    baselineLine.setAttribute("x1", leftPadding);
    baselineLine.setAttribute("x2", svgWidth - rightPadding);
    baselineLine.setAttribute("y1", baselineYCoord);
    baselineLine.setAttribute("y2", baselineYCoord);
    svg.appendChild(baselineLine);
  }

  const avgRatio = Math.min(Math.max((averagePrice - axisMin) / axisRange, 0), 1);
  const avgY = topPadding + (1 - avgRatio) * drawableHeight;
  const avgLine = document.createElementNS(svgNS, "line");
  avgLine.classList.add("chart-average");
  avgLine.setAttribute("x1", leftPadding);
  avgLine.setAttribute("x2", svgWidth - rightPadding);
  avgLine.setAttribute("y1", avgY);
  avgLine.setAttribute("y2", avgY);
  svg.appendChild(avgLine);

  canvas.appendChild(svg);

  const yScale = document.createElement("div");
  yScale.className = "chart-y-scale";
  for (let i = 0; i <= ySteps; i += 1) {
    const value = axisMin + ((axisMax - axisMin) * (ySteps - i)) / ySteps;
    const label = document.createElement("span");
    label.textContent = `${formatAxisLabel(value)} ${unit}`;
    yScale.appendChild(label);
  }
  canvas.appendChild(yScale);

  if (hasLoadData) {
    const yScaleRight = document.createElement("div");
    yScaleRight.className = "chart-y-scale chart-y-scale--right";
    for (let i = 0; i <= ySteps; i += 1) {
      const value = (loadAxisMax * (ySteps - i)) / ySteps;
      const label = document.createElement("span");
      label.textContent = `${formatKw(value)} kW`;
      yScaleRight.appendChild(label);
    }
    canvas.appendChild(yScaleRight);
  }

  const labelInterval = Math.max(1, Math.round(slots.length / 12));
  for (let i = 0; i <= ySteps; i += 1) {
    const y = topPadding + (i / ySteps) * drawableHeight;
    const gridline = document.createElementNS(svgNS, "line");
    gridline.classList.add("chart-gridline");
    gridline.setAttribute("x1", leftPadding);
    gridline.setAttribute("x2", svgWidth - rightPadding);
    gridline.setAttribute("y1", y);
    gridline.setAttribute("y2", y);
    svg.appendChild(gridline);
  }

  for (let i = 0; i < points.length; i += labelInterval) {
    const point = points[i];
    const vLine = document.createElementNS(svgNS, "line");
    vLine.classList.add("chart-gridline");
    vLine.setAttribute("x1", point.x);
    vLine.setAttribute("x2", point.x);
    vLine.setAttribute("y1", topPadding);
    vLine.setAttribute("y2", baselineY);
    vLine.setAttribute("stroke-dasharray", "4 8");
    svg.appendChild(vLine);
  }
  if ((points.length - 1) % labelInterval !== 0) {
    const vLine = document.createElementNS(svgNS, "line");
    vLine.classList.add("chart-gridline");
    vLine.setAttribute("x1", lastPoint.x);
    vLine.setAttribute("x2", lastPoint.x);
    vLine.setAttribute("y1", topPadding);
    vLine.setAttribute("y2", baselineY);
    vLine.setAttribute("stroke-dasharray", "4 8");
    svg.appendChild(vLine);
  }

  const xAxis = document.createElement("div");
  xAxis.className = "chart-x-axis";
  const xLabels = [];
  for (let i = 0; i < points.length; i += labelInterval) {
    xLabels.push(points[i]);
  }
  if (!xLabels.includes(lastPoint)) {
    xLabels.push(lastPoint);
  }
  xLabels.forEach((point) => {
    const label = document.createElement("span");
    label.style.left = `${point.x}px`;
    label.textContent = formatShortTime(point.slot.start);
    xAxis.appendChild(label);
  });
  canvas.appendChild(xAxis);

  const overlay = document.createElement("div");
  overlay.className = "chart-overlay";
  overlay.style.width = `${svgWidth}px`;
  overlay.style.height = `${svgHeight}px`;
  canvas.appendChild(overlay);

  chart.appendChild(surface);

  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  chart.appendChild(tooltip);

  let activePoint = null;

  const showTooltip = (target, slot) => {
    const delta = slot.price - averagePrice;
    const deltaClass = delta >= 0 ? "delta delta--up" : "delta delta--down";
    const key = toSlotKey(slot.start);
    const energy = key !== null ? latestLoadProfileMap.get(key) : undefined;
    const hasSlotLoad = typeof energy === "number" && Number.isFinite(energy);
    const loadPower = hasSlotLoad ? energy * loadMultiplier : null;
    const loadLine = hasSlotLoad
      ? `<div class="tooltip-load">Lastgang: ${formatKw(loadPower)} kW (${formatNumber(
          energy,
          2
        )} kWh)</div>`
      : "";
    const baselineLineHtml = baselineWithinRange
      ? `<div class="tooltip-baseline">Einheitstarif: ${formatPrice(currentBaselineRate)}</div>`
      : "";
    tooltip.innerHTML = `
      <strong>${formatRange(slot.start, slot.end)}</strong>
      <div>${slot.price.toFixed(4)} ${unit}</div>
      ${loadLine}
      ${baselineLineHtml}
      <div class="${deltaClass}">${delta >= 0 ? "+" : ""}${delta.toFixed(4)} ${unit} vs &Oslash;</div>
    `;
    const chartRect = chart.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const centerX = targetRect.left + targetRect.width / 2 - chartRect.left;
    const topY = targetRect.top - chartRect.top;
    const clampedX = Math.min(chartRect.width - 20, Math.max(20, centerX));
    tooltip.style.left = `${clampedX}px`;
    tooltip.style.top = `${topY}px`;
    tooltip.classList.add("visible");
  };

  const hideTooltip = () => {
    tooltip.classList.remove("visible");
  };

  const clearActivePoint = () => {
    if (activePoint) {
      activePoint.classList.remove("is-active");
      activePoint = null;
    }
  };

  points.forEach((point) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chart-point";
    button.style.left = `${point.x}px`;
    button.style.top = `${point.y}px`;
    button.setAttribute(
      "aria-label",
      `${formatRange(point.slot.start, point.slot.end)}: ${point.slot.price.toFixed(4)} ${unit}`
    );
    if (point.slot === minSlot) button.classList.add("is-min");
    if (point.slot === maxSlot) button.classList.add("is-max");

    const activate = () => {
      if (activePoint && activePoint !== button) {
        activePoint.classList.remove("is-active");
      }
      activePoint = button;
      activePoint.classList.add("is-active");
      showTooltip(button, point.slot);
    };

    const deactivate = () => {
      if (button === activePoint) {
        clearActivePoint();
      } else {
        button.classList.remove("is-active");
      }
      hideTooltip();
    };

    button.addEventListener("mouseenter", activate);
    button.addEventListener("focus", activate);
    button.addEventListener("pointermove", () => showTooltip(button, point.slot));
    button.addEventListener("mouseleave", deactivate);
    button.addEventListener("blur", deactivate);

    overlay.appendChild(button);
  });

  overlay.addEventListener("mouseleave", () => {
    clearActivePoint();
    hideTooltip();
  });
  surface.addEventListener("scroll", () => {
    clearActivePoint();
    hideTooltip();
  });
}

function renderComparison(slots) {
  const container = document.querySelector("#comparison");
  if (!container) return;

  if (latestLoadProfileError) {
    container.innerHTML = `<div class="alert">${latestLoadProfileError}</div>`;
    return;
  }

  if (!latestLoadProfile.length) {
    container.innerHTML = `<p class="comparison-empty">Lade einen 15-Minuten-Lastgang (CSV) hoch, um den Kostenvergleich mit ${formatPrice(
      currentBaselineRate
    )} zu sehen.</p>`;
    return;
  }

  const comparison = computeCostComparison(slots, latestLoadProfileMap, currentBaselineRate);

  if (!comparison.matchedCount) {
    container.innerHTML =
      '<p class="comparison-empty">Der hochgeladene Lastgang deckt keinen der angezeigten Zeitslots ab. Bitte pruefe Zeitraum und Zeitzone.</p>';
    return;
  }

  const savingsClass =
    comparison.savings > 0
      ? "comparison-card is-positive"
      : comparison.savings < 0
      ? "comparison-card is-negative"
      : "comparison-card";

  const savingsHint =
    comparison.staticCost > 0
      ? `${formatPercent(comparison.savingsPercent)} vom Einheitstarif`
      : "";

  const profileHintParts = [];
  if (latestLoadProfileMeta?.fileName) {
    profileHintParts.push(latestLoadProfileMeta.fileName);
  }
  if (latestLoadProfileMeta?.rangeStart && latestLoadProfileMeta?.rangeEnd) {
    profileHintParts.push(
      formatRange(latestLoadProfileMeta.rangeStart, latestLoadProfileMeta.rangeEnd)
    );
  }
  if (latestLoadProfileMeta?.unit) {
    profileHintParts.push(latestLoadProfileMeta.unit);
  }
  if (latestLoadProfileMeta?.notes) {
    profileHintParts.push(latestLoadProfileMeta.notes);
  }
  profileHintParts.push(`${comparison.matchedCount}/${slots.length} Slots`);
  const profileHint = profileHintParts.filter(Boolean).join(" &middot; ");

  const summaryItems = [
    `<span>Abdeckung Slots: ${formatPercent(comparison.coverageSlots)}</span>`,
    `<span>Energie ber&uuml;cksichtigt: ${formatPercent(comparison.coverageEnergy)}</span>`,
  ];
  summaryItems.unshift(
    `<span>Einheitstarif: ${formatPrice(currentBaselineRate)}</span>`
  );

  if (comparison.missingCount) {
    summaryItems.push(
      `<span class="status-warn">${comparison.missingCount} Slots ohne Lastgang</span>`
    );
  }

  if (comparison.extraEntries) {
    summaryItems.push(
      `<span class="status-warn">${comparison.extraEntries} Werte ausserhalb des Tarif-Zeitraums</span>`
    );
  }

  container.innerHTML = `
    <div class="comparison-grid">
      <div class="comparison-card">
        <div class="comparison-card__label">Dynamische Kosten</div>
        <div class="comparison-card__value">${formatCurrency(comparison.dynamicCost)}</div>
        <div class="comparison-card__hint">&Oslash; ${formatPrice(comparison.dynamicAveragePrice)} · ${formatNumber(
          comparison.matchedEnergy,
          2
        )} kWh</div>
      </div>
      <div class="comparison-card">
        <div class="comparison-card__label">Einheitstarif</div>
        <div class="comparison-card__value">${formatCurrency(comparison.staticCost)}</div>
        <div class="comparison-card__hint">${formatPrice(currentBaselineRate)} fix</div>
      </div>
      <div class="${savingsClass}">
        <div class="comparison-card__label">Vorteil gg&uuml;. Einheitstarif</div>
        <div class="comparison-card__value">${formatCurrencyDelta(comparison.savings)}</div>
        <div class="comparison-card__hint">${savingsHint || " "}</div>
      </div>
      <div class="comparison-card">
        <div class="comparison-card__label">Lastgang</div>
        <div class="comparison-card__value">${formatNumber(
          comparison.totalProfileEnergy,
          2
        )} kWh</div>
        <div class="comparison-card__hint">${profileHint}</div>
      </div>
    </div>
    <div class="comparison-summary">
      ${summaryItems.join("")}
    </div>
  `;
}

function renderTable(slots) {
  const table = document.querySelector("#price-table");
  if (!table) return;
  const tbody = table.querySelector("tbody");
  const theadRow = table.querySelector("thead tr");
  if (!tbody) return;

  const unit = slots[0]?.unit || "CHF/kWh";
  const hasProfile = latestLoadProfile.length > 0 && !latestLoadProfileError;

  if (theadRow) {
    theadRow.innerHTML = hasProfile
      ? `<th>Zeitslot</th><th>Preis (${unit})</th><th>Lastgang (kWh)</th><th>Dynamisch (CHF)</th><th>Einheitstarif (CHF)</th>`
      : `<th>Zeitslot</th><th>Preis (${unit})</th>`;
  }

  tbody.innerHTML = "";
  const loadMap = latestLoadProfileMap;

  slots.forEach((slot) => {
    const tr = document.createElement("tr");
    const priceCell = `${slot.price.toFixed(4)} ${unit}`;

    if (hasProfile) {
      const key = toSlotKey(slot.start);
      const energy = key !== null ? loadMap.get(key) : undefined;

      if (typeof energy === "number" && Number.isFinite(energy)) {
        const dynamicCost = energy * slot.price;
        const staticCost = energy * currentBaselineRate;
        tr.innerHTML = `
          <td>${formatRange(slot.start, slot.end)}</td>
          <td>${priceCell}</td>
          <td>${formatNumber(energy, 2)}</td>
          <td>${formatCurrency(dynamicCost)}</td>
          <td>${formatCurrency(staticCost)}</td>
        `;
      } else {
        tr.innerHTML = `
          <td>${formatRange(slot.start, slot.end)}</td>
          <td>${priceCell}</td>
          <td>&mdash;</td>
          <td>&mdash;</td>
          <td>&mdash;</td>
        `;
      }
    } else {
      tr.innerHTML = `
        <td>${formatRange(slot.start, slot.end)}</td>
        <td>${priceCell}</td>
      `;
    }

    tbody.appendChild(tr);
  });
}

function formatRange(start, end) {
  return `${formatDate(start)} ${formatTime(start)} - ${formatTime(end)}`;
}

function formatShortTime(date) {
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function formatDate(date) {
  return date.toLocaleDateString("de-CH", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatTime(date) {
  return date.toLocaleTimeString("de-CH", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPrice(value) {
  if (!Number.isFinite(value)) return "–";
  const digits = value >= 1 ? 2 : value >= 0.1 ? 3 : 4;
  return `${value.toFixed(digits)} CHF/kWh`;
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return "–";
  return currencyFormatter.format(value);
}

function formatCurrencyDelta(value) {
  if (!Number.isFinite(value)) return "–";
  const formatted = currencyFormatter.format(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function formatNumber(value, fractionDigits = 2) {
  if (!Number.isFinite(value)) return "-";
  if (!numberFormatters.has(fractionDigits)) {
    numberFormatters.set(
      fractionDigits,
      new Intl.NumberFormat("de-CH", {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      })
    );
  }
  return numberFormatters.get(fractionDigits).format(value);
}

function formatKw(value) {
  if (!Number.isFinite(value)) return "-";
  const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
  return formatNumber(value, digits);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) return "-";
  return percentFormatter.format(value);
}

function toSlotKey(date) {
  if (!(date instanceof Date)) return null;
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return Math.round(time / SLOT_INTERVAL_MS) * SLOT_INTERVAL_MS;
}

function computeCostComparison(slots, loadMap, baselineRate) {
  let matchedCount = 0;
  let missingCount = 0;
  let matchedEnergy = 0;
  let dynamicCost = 0;
  let staticCost = 0;
  let totalProfileEnergy = 0;
  let extraEntries = 0;
  const matchedKeys = new Set();

  loadMap.forEach((energy) => {
    if (Number.isFinite(energy)) {
      totalProfileEnergy += energy;
    }
  });

  slots.forEach((slot) => {
    const key = toSlotKey(slot.start);
    const energy = key !== null ? loadMap.get(key) : undefined;

    if (typeof energy === "number" && Number.isFinite(energy)) {
      matchedCount += 1;
      matchedEnergy += energy;
      dynamicCost += energy * slot.price;
      staticCost += energy * baselineRate;
      if (key !== null) {
        matchedKeys.add(key);
      }
    } else {
      missingCount += 1;
    }
  });

  loadMap.forEach((_, key) => {
    if (!matchedKeys.has(key)) {
      extraEntries += 1;
    }
  });

  const coverageSlots = slots.length ? matchedCount / slots.length : 0;
  const coverageEnergy = totalProfileEnergy ? matchedEnergy / totalProfileEnergy : 0;
  const savings = staticCost - dynamicCost;
  const savingsPercent = staticCost ? savings / staticCost : 0;
  const dynamicAveragePrice = matchedEnergy ? dynamicCost / matchedEnergy : 0;

  return {
    matchedCount,
    missingCount,
    extraEntries,
    matchedEnergy,
    totalProfileEnergy,
    dynamicCost,
    staticCost,
    savings,
    savingsPercent,
    dynamicAveragePrice,
    coverageSlots,
    coverageEnergy,
  };
}

function parseLoadProfileFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = typeof reader.result === "string" ? reader.result : "";
        const parsed = parseLoadProfileCsv(text);
        resolve(parsed);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => {
      reject(new Error("Die CSV-Datei konnte nicht gelesen werden."));
    };
    reader.readAsText(file, "utf-8");
  });
}

function parseLoadProfileCsv(text) {
  if (!text || !text.trim()) {
    throw new Error("Die CSV-Datei ist leer.");
  }

  const lines = text
    .split(/\r?\n|\r/)
    .map((line) => line.trim())
    .filter((line) => line.length);

  if (!lines.length) {
    throw new Error("Die CSV-Datei enthaelt keine Datenzeilen.");
  }

  let headerLine = lines[0].replace(/\ufeff/g, "");
  const delimiter = detectDelimiter(headerLine);
  const headerCells = headerLine.split(delimiter).map((cell) => cell.trim());
  let startIndex = 0;
  let timeIndex = 0;
  let valueIndex = 1;
  let valuesArePower = false;

  const firstTimestamp = parseTimestamp(headerCells[0]);

  if (!firstTimestamp) {
    const normalizedHeaders = headerCells.map((cell) => cell.toLowerCase());
    const timeKeywords = ["timestamp", "zeitpunkt", "zeit", "datetime", "start", "von"];
    const valueKeywords = ["value", "kwh", "kw", "verbrauch", "lastgang", "leistung"];
    timeIndex = normalizedHeaders.findIndex((cell) =>
      timeKeywords.some((keyword) => cell.includes(keyword))
    );
    valueIndex = normalizedHeaders.findIndex((cell) =>
      valueKeywords.some((keyword) => cell.includes(keyword))
    );

    if (timeIndex === -1) timeIndex = 0;
    if (valueIndex === -1 || valueIndex === timeIndex) valueIndex = timeIndex === 0 ? 1 : 0;
    if (valueIndex < 0) {
      throw new Error("Die CSV muss mindestens eine Spalte f&uuml;r Zeitstempel und kWh enthalten.");
    }
    startIndex = 1;
  } else if (headerCells.length > 1) {
    timeIndex = 0;
    valueIndex = 1;
  } else {
    throw new Error("Die CSV muss mindestens zwei Spalten enthalten (Zeitstempel, kWh).");
  }

  const valueHeader = headerCells[valueIndex]?.toLowerCase() || "";
  if (
    /\bkw\b/.test(valueHeader) ||
    /\bleistung\b/.test(valueHeader) ||
    /1\.29\.0\*255/.test(valueHeader)
  ) {
    valuesArePower = true;
  }

  const entries = [];
  const extraTexts = [];

  for (let i = startIndex; i < lines.length; i += 1) {
    const rawLine = lines[i];
    if (!rawLine) continue;

    const cells = rawLine.replace(/\ufeff/g, "").split(delimiter).map((cell) => cell.trim());
    if (cells.length <= Math.max(timeIndex, valueIndex)) continue;

    const timestamp = parseTimestamp(cells[timeIndex]);
    if (!timestamp) continue;

    const energy = sanitizeNumber(cells[valueIndex]);
    if (!Number.isFinite(energy)) continue;

    const extraText = cells
      .filter((_, idx) => idx !== timeIndex && idx !== valueIndex)
      .join(" ")
      .toLowerCase();
    if (!valuesArePower && /\b(w|kw)\b/.test(extraText)) {
      valuesArePower = true;
    }
    if (extraText) {
      extraTexts.push(extraText);
    }

    const end = new Date(timestamp.getTime() + SLOT_INTERVAL_MS);
    entries.push({ start: timestamp, end, energy });
  }

  if (!entries.length) {
    throw new Error("Keine gueltigen Messwerte im Lastgang gefunden.");
  }

  entries.sort((a, b) => a.start - b.start);

  if (valuesArePower) {
    const factor = LOAD_PROFILE_INTERVAL_MINUTES / 60;
    entries.forEach((entry) => {
      entry.energy *= factor;
    });
  }

  const totalEnergy = entries.reduce((sum, entry) => sum + entry.energy, 0);
  let notes = extractNotes(extraTexts);
  if (valuesArePower) {
    const conversionNote = "Konvertiert von kW (15 Minuten) zu kWh.";
    notes = notes ? `${notes} · ${conversionNote}` : conversionNote;
  }

  return {
    entries,
    meta: {
      totalRows: entries.length,
      totalEnergy,
      intervalMinutes: LOAD_PROFILE_INTERVAL_MINUTES,
      rangeStart: entries[0].start,
      rangeEnd: entries[entries.length - 1].end,
      unit: valuesArePower ? "kW · 15min → kWh" : "kWh",
      notes,
    },
  };
}

function detectDelimiter(sample) {
  if (sample.includes(";")) return ";";
  if (sample.includes("\t")) return "\t";
  return ",";
}

function extractNotes(texts) {
  if (!Array.isArray(texts) || !texts.length) return undefined;
  const lowered = texts.join(" ");
  if (/\bgemessen\b/.test(lowered) && /\bw\b/.test(lowered)) {
    return "Status: Gemessen, Werte als Leistung (W).";
  }
  return undefined;
}

function parseTimestamp(value) {
  if (!value) return null;
  const trimmed = value.replace(/\ufeff/g, "").trim();
  if (!trimmed) return null;

  let date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  const isoCandidate = trimmed.replace(" ", "T");
  date = new Date(isoCandidate);
  if (!Number.isNaN(date.getTime())) {
    return date;
  }

  const swissMatch = trimmed.match(
    /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );
  if (swissMatch) {
    const [, dayStr, monthStr, yearStr, hourStr, minuteStr, secondStr] = swissMatch;
    const year = Number(yearStr.length === 2 ? `20${yearStr}` : yearStr);
    const month = Number(monthStr) - 1;
    const day = Number(dayStr);
    const hour = Number(hourStr);
    const minute = Number(minuteStr);
    const second = secondStr ? Number(secondStr) : 0;
    const parsed = new Date(year, month, day, hour, minute, second, 0);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function sanitizeNumber(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const cleaned = value.replace(/[^0-9,.\-+]/g, "").replace(/,/g, ".");
  if (!cleaned) return NaN;
  return Number(cleaned);
}

function toLocalDateTime(date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function buildDemoData() {
  const result = [];
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const slotMinutes = 15;

  for (let i = 0; i < 96; i += 1) {
    const start = new Date(base.getTime() + i * slotMinutes * 60 * 1000);
    const end = new Date(start.getTime() + slotMinutes * 60 * 1000);

    const priceSwing = 0.05 * Math.sin((i / 96) * Math.PI * 4);
    const baseIntegrated = 0.22 + priceSwing + randomNoise(0.01);
    const gridUsage = baseIntegrated - 0.09;
    const electricity = 0.12 + priceSwing * 0.6 + randomNoise(0.007);
    const grid = gridUsage + 0.030 + 0.0027 + 0.0041 + 0.0005 + 0.023;

    result.push({
      start_timestamp: start.toISOString(),
      end_timestamp: end.toISOString(),
      integrated: [
        {
          unit: "CHF_kWh",
          value: baseIntegrated.toFixed(4),
        },
      ],
      grid_usage: [
        {
          unit: "CHF_kWh",
          value: gridUsage.toFixed(4),
        },
      ],
      grid: [
        {
          unit: "CHF_kWh",
          value: grid.toFixed(4),
        },
      ],
      electricity: [
        {
          unit: "CHF_kWh",
          value: electricity.toFixed(4),
        },
      ],
    });
  }

  return result;
}

function randomNoise(scale) {
  return (Math.random() - 0.5) * scale;
}
