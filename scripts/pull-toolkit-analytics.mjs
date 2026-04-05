import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

const PROPERTY_ID = "530034293";
const OUTPUT_PATH = path.resolve("src/data/toolkit-analytics.json");

// Put your downloaded service-account JSON somewhere outside git if possible,
// then point GOOGLE_APPLICATION_CREDENTIALS to it before running this script.
const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

if (!credentialsPath) {
  throw new Error(
    "Missing GOOGLE_APPLICATION_CREDENTIALS. Set it to your GA4 service-account JSON path."
  );
}

const client = new BetaAnalyticsDataClient({
    keyFilename: credentialsPath,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });

  function cleanValue(value) {
    const v = String(value || "").trim();
    return v === "(not set)" ? "" : v;
  }

function toMap(rows = [], dimensionKeyIndex = 0, metricValueIndex = 0) {
  const map = new Map();

  for (const row of rows) {
    const key = cleanValue(row.dimensionValues?.[dimensionKeyIndex]?.value);
    const rawValue = row.metricValues?.[metricValueIndex]?.value ?? "0";
    const value = Number.parseInt(rawValue, 10) || 0;
    if (key) map.set(key, value);
  }

  return map;
}

function sortEntriesDesc(map) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

async function runReport({ dimensions, metrics, dateRanges, dimensionFilter, limit = 100 }) {
  const [response] = await client.runReport({
    property: `properties/${PROPERTY_ID}`,
    dimensions,
    metrics,
    dateRanges,
    dimensionFilter,
    limit,
  });

  return response.rows || [];
}

async function getMostPopularFramework() {
  const rows = await runReport({
    dimensions: [{ name: "customEvent:framework" }],
    metrics: [{ name: "eventCount" }],
    dateRanges: [{ startDate: "1daysAgo", endDate: "today" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: {
          matchType: "EXACT",
          value: "framework_click",
        },
      },
    },
    limit: 100,
  });

  const ranked = sortEntriesDesc(toMap(rows));
  const [frameworkName = "—", metricValue = 0] = ranked[0] || [];
  return {
    frameworkName,
    metricValue: String(metricValue),
  };
}

async function getMostDownloadedFramework() {
  const rows = await runReport({
    dimensions: [
      { name: "eventName" },
      { name: "customEvent:framework" },
    ],
    metrics: [{ name: "eventCount" }],
    dateRanges: [{ startDate: "1daysAgo", endDate: "today" }],
    dimensionFilter: {
      orGroup: {
        expressions: [
          {
            filter: {
              fieldName: "eventName",
              stringFilter: {
                matchType: "EXACT",
                value: "framework_download",
              },
            },
          },
          {
            filter: {
              fieldName: "eventName",
              stringFilter: {
                matchType: "EXACT",
                value: "file_download",
              },
            },
          },
        ],
      },
    },
    limit: 200,
  });

  const totals = new Map();

  for (const row of rows) {
    const frameworkName = cleanValue(row.dimensionValues?.[1]?.value);
    const rawValue = row.metricValues?.[0]?.value ?? "0";
    const count = Number.parseInt(rawValue, 10) || 0;
    if (!frameworkName) continue;
    totals.set(frameworkName, (totals.get(frameworkName) || 0) + count);
  }

  const ranked = sortEntriesDesc(totals);
  const [frameworkName = "—", metricValue = 0] = ranked[0] || [];
  return {
    frameworkName,
    metricValue: String(metricValue),
  };
}

async function getMostLikedFramework() {
  const rows = await runReport({
    dimensions: [
      { name: "customEvent:framework" },
      { name: "customEvent:action" },
    ],
    metrics: [{ name: "eventCount" }],
    dateRanges: [{ startDate: "1daysAgo", endDate: "today" }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "eventName",
              stringFilter: {
                matchType: "EXACT",
                value: "framework_feedback",
              },
            },
          },
          {
            filter: {
              fieldName: "customEvent:action",
              stringFilter: {
                matchType: "EXACT",
                value: "like",
              },
            },
          },
        ],
      },
    },
    limit: 100,
  });

  const ranked = sortEntriesDesc(toMap(rows));
  const [frameworkName = "—", metricValue = 0] = ranked[0] || [];
  return {
    frameworkName,
    metricValue: String(metricValue),
  };
}

async function main() {
  const [mostPopular, mostDownloaded, mostLiked] = await Promise.all([
    getMostPopularFramework(),
    getMostDownloadedFramework(),
    getMostLikedFramework(),
  ]);

  const payload = {
    mostPopular,
    mostDownloaded,
    mostLiked,
    generatedAt: new Date().toISOString(),
    propertyId: PROPERTY_ID,
    range: "1daysAgo:today",
  };

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(payload, null, 2) + "\n", "utf8");

  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(payload);
}

main().catch((error) => {
  console.error("Failed to pull toolkit analytics");
  console.error(error);
  process.exit(1);
});