const API_URL = "https://e-ckw-public-data.de-c1.eu1.cloudhub.io/api/v1/netzinformationen/energie/dynamische-preise";

const APPLIANCES = [
  {
    id: "ev",
    name: "E-Auto laden",
    description: "Ladefenster fuer eine typische 7.4 kW Wallbox (4 Stunden)",
    durationMinutes: 240,
  },
  {
    id: "dryer",
    name: "Tumbler",
    description: "Standardprogramm Trocken (90 Minuten)",
    durationMinutes: 90,
  },
  {
    id: "heat_pump",
    name: "Waermepumpe / Heizungsschub",
    description: "Zusaetzlicher Heizzyklus (120 Minuten)",
    durationMinutes: 120,
  },
  {
    id: "water",
    name: "Boiler / Warmwasser",
    description: "Aufheizen des Boilers (60 Minuten)",
    durationMinutes: 60,
  },
];

const DEMO_DATA = buildDemoData();

let latestSlots = [];

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector("#query-form");
  const startInput = document.querySelector("#start");
  const endInput = document.querySelector("#end");
  const useDemoCheckbox = document.querySelector("#use-demo");

  const today = new Date();
  today.setMinutes(0, 0, 0);
  const startOfDay = new Date(today);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  startInput.value = toLocalDateTime(startOfDay);
  endInput.value = toLocalDateTime(endOfDay);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setLoadingState(true);

    const formData = new FormData(form);
    const params = Object.fromEntries(formData.entries());

    try {
      const data = useDemoCheckbox.checked
        ? DEMO_DATA
        : await fetchTariffs(params);

      renderDashboard(data, params.tariff_type || "integrated");
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

function renderDashboard(data, tariffType) {
  const slots = normalizeSlots(data, tariffType);

  if (!slots.length) {
    renderError("Keine Daten fuer den gewaehlten Zeitraum/Tariftyp gefunden.");
    return;
  }

  latestSlots = slots;

  renderRecommendations(slots);
  renderChart(slots);
  renderTable(slots);
}

function renderError(message) {
  latestSlots = [];
  const recommendations = document.querySelector("#recommendations");
  const chart = document.querySelector("#chart");
  const tableBody = document.querySelector("#price-table tbody");

  recommendations.innerHTML = `<div class="alert">${message}</div>`;
  chart.innerHTML = "";
  tableBody.innerHTML = "";
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
        unit: priceEntry.unit?.replace("_", "/") || "CHF/kWh",
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

function renderRecommendations(slots) {
  const container = document.querySelector("#recommendations");
  container.innerHTML = "";

  APPLIANCES.forEach((appliance) => {
    const recommendation = findCheapestWindow(slots, appliance.durationMinutes);
    if (!recommendation) return;

    const card = document.createElement("article");
    card.className = "recommendation-card";
    card.innerHTML = `
      <h3>${appliance.name}</h3>
      <div class="time">${formatRange(recommendation.start, recommendation.end)}</div>
      <div class="price">${recommendation.averagePrice.toFixed(4)} CHF/kWh</div>
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
        };
      }
    }
  }

  return best;
}

function renderChart(slots) {
  const chart = document.querySelector("#chart");
  chart.innerHTML = "";

  const maxPrice = Math.max(...slots.map((slot) => slot.price));

  slots.forEach((slot) => {
    const bar = document.createElement("div");
    bar.className = "bar";
    const height = Math.max(6, (slot.price / maxPrice) * 190);
    bar.style.height = `${height}px`;
    bar.dataset.time = formatShortTime(slot.start);
    bar.dataset.price = slot.price.toFixed(4);
    chart.appendChild(bar);
  });
}

function renderTable(slots) {
  const tbody = document.querySelector("#price-table tbody");
  tbody.innerHTML = "";

  slots.forEach((slot) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatRange(slot.start, slot.end)}</td>
      <td>${slot.price.toFixed(4)} ${slot.unit}</td>
    `;
    tbody.appendChild(tr);
  });
}

function formatRange(start, end) {
  return `${formatDate(start)} ${formatTime(start)} – ${formatTime(end)}`;
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
