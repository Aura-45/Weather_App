const GEOCODING_API = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_API = "https://api.open-meteo.com/v1/forecast";

const $ = (id) => document.getElementById(id);

const searchForm = $("searchForm");
const cityInput = $("cityInput");
const searchButton = $("searchButton");
const unitToggle = $("unitToggle");
const statusMessage = $("statusMessage");
const weatherContent = $("weatherContent");
const welcomeCard = $("welcomeCard");
const forecastList = $("forecastList");

let temperatureUnit = "celsius";
let currentWeatherData = null;
let requestController = null;
let requestId = 0;
let activeTimeZone = "Asia/Kolkata";
let clockInterval = null;

// Open-Meteo WMO weather codes.
const weatherCodes = {
  0: ["Clear sky", "☀️"],
  1: ["Mainly clear", "🌤️"],
  2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"],
  45: ["Foggy", "🌫️"],
  48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"],
  53: ["Drizzle", "🌦️"],
  55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"],
  57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"],
  63: ["Rain", "🌧️"],
  65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"],
  67: ["Heavy freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"],
  73: ["Snow", "🌨️"],
  75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"],
  80: ["Rain showers", "🌦️"],
  81: ["Rain showers", "🌧️"],
  82: ["Heavy showers", "⛈️"],
  85: ["Snow showers", "🌨️"],
  86: ["Heavy snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"],
  96: ["Thunderstorm with hail", "⛈️"],
  99: ["Severe thunderstorm", "⛈️"]
};

// -------------------------------
// API HELPERS
// -------------------------------

async function fetchJSON(url, signal) {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    throw new Error(
      response.status === 429
        ? "Too many requests. Please wait a moment and try again."
        : `Weather service returned an error (${response.status}).`
    );
  }

  return response.json();
}

async function findCity(city, signal) {
  const url = new URL(GEOCODING_API);
  url.search = new URLSearchParams({
    name: city,
    count: "10",
    language: "en",
    format: "json"
  });

  const data = await fetchJSON(url, signal);

  if (!data.results || data.results.length === 0) {
    throw new Error(`No city found for '${city}'. Check the spelling and try again.`);
  }

  const results = data.results;
  const exact = results.find(
    (place) => place.name.toLowerCase() === city.toLowerCase()
  );

  return exact || results[0];
}

async function fetchForecast(place, signal) {
  const url = new URL(FORECAST_API);

  const params = {
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m"
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min"
    ].join(","),
    temperature_unit: temperatureUnit,
    wind_speed_unit: "kmh",
    timezone: "auto",
    forecast_days: "5"
  };

  url.search = new URLSearchParams(params);
  return fetchJSON(url, signal);
}

// -------------------------------
// DISPLAY HELPERS
// -------------------------------

function getWeatherInfo(code) {
  return weatherCodes[code] || ["Unknown conditions", "🌡️"];
}

function formatTemperature(value) {
  if (!Number.isFinite(value)) return "--°";
  return `${Math.round(value)}°`;
}

function formatWindDirection(degrees) {
  if (!Number.isFinite(degrees)) return "Direction unavailable";

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return `${directions[Math.round(degrees / 45) % 8]} wind`;
}

function formatDate(dateString, options) {
  // Noon avoids accidental date shifts caused by UTC conversion.
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return new Intl.DateTimeFormat("en-IN", options).format(date);
}

function updateLocalClock() {
  const timeElement = $("localTime");
  if (!timeElement) return;

  try {
    timeElement.textContent = new Intl.DateTimeFormat("en-IN", {
      timeZone: activeTimeZone,
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(new Date());
  } catch (error) {
    // Fallback to the browser's local clock if a timezone is unavailable.
    timeElement.textContent = new Intl.DateTimeFormat("en-IN", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(new Date());
    console.warn("Could not format the selected city's time zone:", error);
  }
}

function startLocalClock(timeZone) {
  activeTimeZone = timeZone || "Asia/Kolkata";
  updateLocalClock();

  if (clockInterval !== null) {
    clearInterval(clockInterval);
  }

  // Refresh the display every second, independently of the weather API.
  clockInterval = setInterval(updateLocalClock, 1000);
}

function showStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.className = "status-message visible";

  if (type === "error") {
    statusMessage.classList.add("error");
  }
}

function hideStatus() {
  statusMessage.className = "status-message";
  statusMessage.textContent = "";
}

function showWeather() {
  weatherContent.hidden = false;
  welcomeCard.hidden = true;
}

function showWelcome() {
  weatherContent.hidden = true;
  welcomeCard.hidden = false;
}

function showLoading(city) {
  showStatus(`Finding weather for ${city}...`);
  searchButton.disabled = true;
  searchButton.textContent = "Loading...";
}

// -------------------------------
// RENDER CURRENT WEATHER
// -------------------------------

function renderCurrentWeather(place, data) {
  const current = data.current;
  const daily = data.daily;

  const [condition, icon] = getWeatherInfo(current.weather_code);

  $("cityName").textContent = place.name;

  const region = [place.admin1, place.country].filter(Boolean).join(", ");
  $("locationMeta").textContent =
    region || `Lat ${place.latitude.toFixed(2)}, Lon ${place.longitude.toFixed(2)}`;

  $("mainWeatherIcon").textContent = icon;
  $("mainWeatherIcon").setAttribute("aria-label", condition);

  $("temperature").textContent = formatTemperature(current.temperature_2m);
  $("condition").textContent = condition;
  $("feelsLike").textContent = `Feels like ${formatTemperature(current.apparent_temperature)}`;

  $("humidity").textContent = Number.isFinite(current.relative_humidity_2m)
    ? `${Math.round(current.relative_humidity_2m)}%`
    : "--";

  $("windSpeed").textContent = Number.isFinite(current.wind_speed_10m)
    ? `${Math.round(current.wind_speed_10m)} km/h`
    : "-- km/h";

  $("windDirection").textContent = formatWindDirection(current.wind_direction_10m);

  $("pressure").textContent = Number.isFinite(current.pressure_msl)
    ? `${Math.round(current.pressure_msl)} hPa`
    : "-- hPa";

  $("cloudCover").textContent = Number.isFinite(current.cloud_cover)
    ? `${Math.round(current.cloud_cover)}%`
    : "--%";

  $("highTemp").textContent = formatTemperature(daily.temperature_2m_max[0]);
  $("lowTemp").textContent = formatTemperature(daily.temperature_2m_min[0]);

  // The live clock uses the selected city's timezone, not the API's
  // last weather observation time. It continues ticking between API updates.
  startLocalClock(data.timezone);

  $("updatedAt").textContent =
    `Weather observation: ${current.time.replace("T", " ")} · ${data.timezone}`;

  $("timezoneLabel").textContent = `Local time zone: ${data.timezone}`;
  document.title = `${place.name} Weather | SkyCast`;
}

// -------------------------------
// RENDER 5-DAY FORECAST
// -------------------------------

function renderForecast(data) {
  forecastList.replaceChildren();
  const daily = data.daily;

  daily.time.forEach((date, index) => {
    const [condition, icon] = getWeatherInfo(daily.weather_code[index]);

    const day = document.createElement("article");
    day.className = "forecast-day";

    const dayName = document.createElement("span");
    dayName.className = "day-name";
    dayName.textContent = index === 0
      ? "Today"
      : formatDate(date, { weekday: "short" });

    const dayIcon = document.createElement("span");
    dayIcon.className = "day-icon";
    dayIcon.textContent = icon;
    dayIcon.setAttribute("aria-label", condition);

    const dayCondition = document.createElement("span");
    dayCondition.className = "day-condition";
    dayCondition.textContent = condition;

    const temps = document.createElement("div");
    temps.className = "day-temps";

    const high = document.createElement("span");
    high.textContent = formatTemperature(daily.temperature_2m_max[index]);

    const low = document.createElement("span");
    low.className = "low";
    low.textContent = formatTemperature(daily.temperature_2m_min[index]);

    temps.append(high, low);
    day.append(dayName, dayIcon, dayCondition, temps);
    forecastList.append(day);
  });
}

// -------------------------------
// SEARCH WEATHER
// -------------------------------

async function searchWeather(city) {
  const query = city.trim();

  if (!query) {
    showStatus("Please enter a city name.", "error");
    cityInput.focus();
    return;
  }

  if (requestController) {
    requestController.abort();
  }

  requestController = new AbortController();
  const signal = requestController.signal;
  const thisRequestId = ++requestId;

  showLoading(query);

  try {
    const place = await findCity(query, signal);
    const data = await fetchForecast(place, signal);

    if (thisRequestId !== requestId) return;

    if (!data.current || !data.daily || !data.timezone) {
      throw new Error("Weather data is incomplete. Please try again.");
    }

    currentWeatherData = { place, data };
    renderCurrentWeather(place, data);
    renderForecast(data);

    showWeather();
    hideStatus();
    cityInput.value = place.name;
  } catch (error) {
    if (error.name === "AbortError" || thisRequestId !== requestId) {
      return;
    }

    console.error("Weather request failed:", error);

    showStatus(
      error instanceof TypeError
        ? "Unable to connect. Check your internet connection and try again."
        : error.message || "Unable to load weather. Please try again.",
      "error"
    );

    if (!currentWeatherData) {
      showWelcome();
    }
  } finally {
    if (thisRequestId === requestId) {
      searchButton.disabled = false;
      searchButton.innerHTML = 'Search <span aria-hidden="true">↗</span>';
      requestController = null;
    }
  }
}

// -------------------------------
// EVENTS
// -------------------------------

searchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchWeather(cityInput.value);
});

document.querySelectorAll("[data-city]").forEach((button) => {
  button.addEventListener("click", () => {
    const city = button.dataset.city;
    cityInput.value = city;
    searchWeather(city);
  });
});

unitToggle.addEventListener("click", () => {
  temperatureUnit = temperatureUnit === "celsius" ? "fahrenheit" : "celsius";

  unitToggle.innerHTML = temperatureUnit === "celsius"
    ? '°C <span>/</span> °F'
    : '°F <span>/</span> °C';

  unitToggle.setAttribute(
    "aria-label",
    `Temperature unit is ${temperatureUnit}; click to switch units`
  );

  if (currentWeatherData) {
    searchWeather(currentWeatherData.place.name);
  }
});

// -------------------------------
// INITIAL STATE
// -------------------------------

$("year").textContent = new Date().getFullYear();
showWelcome();
startLocalClock("Asia/Kolkata");

// Load an initial city so the dashboard isn't empty.
searchWeather("Lucknow");