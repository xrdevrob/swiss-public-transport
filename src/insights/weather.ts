export interface WeatherSample {
  station: string;
  time: string;
  lat: number;
  lon: number;
  temperature: number;
  precipitation: number;
  snowfall: number;
  windSpeed: number;
  windGusts: number;
  weatherCode: number;
}

export interface WeatherReason {
  code: string;
  label: string;
  penalty: number;
}

export interface WeatherInsight {
  level: "low" | "medium" | "high";
  penalty: number;
  reasons: WeatherReason[];
  samples: WeatherSample[];
}

const cache = new Map<string, { data: WeatherSample; expires: number }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

function getCacheKey(lat: number, lon: number, hour: string): string {
  return `weather:${lat.toFixed(2)}:${lon.toFixed(2)}:${hour}`;
}

async function fetchWeatherForPoint(lat: number, lon: number, datetime: string): Promise<WeatherSample | null> {
  const date = new Date(datetime);
  // Format date in Zurich timezone for cache key and API
  const zurichFormatter = new Intl.DateTimeFormat("sv-SE", { 
    timeZone: "Europe/Zurich", 
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit"
  });
  const parts = zurichFormatter.formatToParts(date);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || "";
  const dateStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}`;
  const targetHour = parseInt(getPart("hour"));
  
  const cacheKey = getCacheKey(lat, lon, `${dateStr}T${targetHour}`);

  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lon.toFixed(4));
  url.searchParams.set("hourly", "temperature_2m,precipitation,snowfall,wind_speed_10m,wind_gusts_10m,weather_code");
  url.searchParams.set("start_date", dateStr);
  url.searchParams.set("end_date", dateStr);
  url.searchParams.set("timezone", "Europe/Zurich");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) return null;

    const data = await response.json();
    const hourly = data.hourly;
    if (!hourly?.time?.length) return null;

    // API returns times like "2026-01-03T17:00" in local Zurich time - extract hour directly
    const hourIndex = hourly.time.findIndex((t: string) => parseInt(t.slice(11, 13)) === targetHour);
    if (hourIndex === -1) return null;

    const sample: WeatherSample = {
      station: "",
      time: datetime,
      lat,
      lon,
      temperature: hourly.temperature_2m?.[hourIndex] ?? 0,
      precipitation: hourly.precipitation?.[hourIndex] ?? 0,
      snowfall: hourly.snowfall?.[hourIndex] ?? 0,
      windSpeed: hourly.wind_speed_10m?.[hourIndex] ?? 0,
      windGusts: hourly.wind_gusts_10m?.[hourIndex] ?? 0,
      weatherCode: hourly.weather_code?.[hourIndex] ?? 0,
    };

    cache.set(cacheKey, { data: sample, expires: Date.now() + CACHE_TTL_MS });
    return sample;
  } catch {
    return null;
  }
}

interface StationCoord {
  name: string;
  lat: number;
  lon: number;
  time: string;
}

export async function getWeatherInsights(stations: StationCoord[]): Promise<WeatherInsight> {
  const samples: WeatherSample[] = [];
  const reasons: WeatherReason[] = [];
  let totalPenalty = 0;

  const limitedStations = stations.slice(0, 4);

  await Promise.all(
    limitedStations.map(async (station) => {
      const sample = await fetchWeatherForPoint(station.lat, station.lon, station.time);
      if (sample) {
        sample.station = station.name;
        samples.push(sample);
      }
    })
  );

  for (const sample of samples) {
    // Snow risk: temp < 1°C AND precipitation
    if (sample.temperature < 1 && sample.precipitation > 0.5) {
      const penalty = 0.20;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "snow_risk")) {
        reasons.push({
          code: "snow_risk",
          label: `Snow risk at ${sample.station}`,
          penalty,
        });
      }
    }

    // Heavy precipitation
    if (sample.precipitation > 5) {
      const penalty = 0.12;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "heavy_rain")) {
        reasons.push({
          code: "heavy_rain",
          label: `Heavy rain at ${sample.station}`,
          penalty,
        });
      }
    } else if (sample.precipitation > 2) {
      const penalty = 0.06;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "rain")) {
        reasons.push({
          code: "rain",
          label: "Rain expected",
          penalty,
        });
      }
    }

    // High wind gusts
    if (sample.windGusts > 60) {
      const penalty = 0.15;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "high_wind")) {
        reasons.push({
          code: "high_wind",
          label: `Strong gusts (${Math.round(sample.windGusts)}km/h)`,
          penalty,
        });
      }
    } else if (sample.windGusts > 40) {
      const penalty = 0.08;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "wind")) {
        reasons.push({
          code: "wind",
          label: "Windy conditions",
          penalty,
        });
      }
    }

    // Freezing conditions
    if (sample.temperature < -5) {
      const penalty = 0.05;
      totalPenalty += penalty;
      if (!reasons.find(r => r.code === "freezing")) {
        reasons.push({
          code: "freezing",
          label: `Freezing (${Math.round(sample.temperature)}°C)`,
          penalty,
        });
      }
    }
  }

  totalPenalty = Math.min(0.35, totalPenalty);

  let level: "low" | "medium" | "high";
  if (totalPenalty >= 0.20) level = "high";
  else if (totalPenalty >= 0.08) level = "medium";
  else level = "low";

  reasons.sort((a, b) => b.penalty - a.penalty);

  return {
    level,
    penalty: totalPenalty,
    reasons: reasons.slice(0, 2),
    samples,
  };
}

export function getWeatherIcon(sample: WeatherSample): string {
  if (sample.snowfall > 0) return "❄️";
  if (sample.precipitation > 5) return "🌧️";
  if (sample.precipitation > 0) return "🌦️";
  if (sample.windGusts > 50) return "💨";
  if (sample.temperature > 25) return "☀️";
  if (sample.temperature < 0) return "🥶";
  return "⛅";
}

export function formatWeatherDescription(sample: WeatherSample): string {
  const parts: string[] = [];
  parts.push(`${Math.round(sample.temperature)}°C`);
  if (sample.precipitation > 0) parts.push(`${sample.precipitation.toFixed(1)}mm rain`);
  if (sample.snowfall > 0) parts.push(`${sample.snowfall.toFixed(1)}cm snow`);
  if (sample.windGusts > 30) parts.push(`gusts ${Math.round(sample.windGusts)}km/h`);
  return parts.join(", ");
}

