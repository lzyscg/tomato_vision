import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const SCRIPT_DIR = path.dirname(__filename);
const MVP_DIR = path.dirname(SCRIPT_DIR);
const ROOT_DIR = path.dirname(MVP_DIR);
const OUTPUT = path.join(ROOT_DIR, "番茄看板.html");

loadEnv(path.join(ROOT_DIR, ".env.local"));

const pool = new Pool({
  host: process.env.PGHOST || process.env.DB_HOST || "10.128.1.3",
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || "qiyin_warehouse",
  user: process.env.PGUSER || process.env.DB_USER || "dbuser_view",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
  ssl: parseSsl(process.env.PGSSL || process.env.DB_SSL || "prefer"),
  connectionTimeoutMillis: 8000,
});

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key.trim()]) process.env[key.trim()] = value;
  }
}

function parseSsl(value) {
  const normalized = String(value || "").toLowerCase();
  if (["false", "0", "disable", "disabled"].includes(normalized)) return false;
  if (["true", "1", "require", "prefer"].includes(normalized)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

function parseNumber(value) {
  const text = cleanText(value).replace(/,/g, "");
  if (!text) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  if (text.includes("亿")) number *= 100000000;
  if (text.includes("万")) number *= 10000;
  return Math.round(number);
}

function parseSongMetric(value) {
  const text = cleanText(value);
  if (!text) return { type: "空", value: null, raw: "" };
  let type = "其他";
  if (text.includes("热度")) type = "热度";
  else if (text.includes("昨日")) type = "昨日播放";
  else if (text.includes("累计")) type = "累计播放";
  else if (text.includes("播放")) type = "播放";
  return { type, value: parseNumber(text), raw: text };
}

function dateTimeLabel(value) {
  if (!value) return "--";
  return String(value).replace("T", " ").slice(0, 19);
}

function isoDateTime(value) {
  if (!value) return "";
  return String(value).replace(" ", "T").slice(0, 19);
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[<>&]/g, (char) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
  }[char]));
}

async function buildStaticData() {
  const [rangeResult, singerResult, songResult] = await Promise.all([
    pool.query(`
      select min(scrape_date)::text as start, max(scrape_date)::text as "end"
      from (
        select scrape_date from ods.ods_scrap_fanqie_singers_df
        union all
        select scrape_date from ods.ods_scrap_fanqie_song_list_df
      ) dates
    `),
    pool.query(`
      select scrape_date::text as scrape_date, singer, singer_tag, song_count, fans_count, genre
      from ods.ods_scrap_fanqie_singers_df
      order by singer, scrape_date
    `),
    pool.query(`
      select scrape_date::text as scrape_date,
             singer,
             song_name,
             song_data,
             likes,
             play_count,
             scrape_time::text as scrape_time,
             create_time::text as create_time
      from ods.ods_scrap_fanqie_song_list_df
      where singer is not null
        and btrim(singer) <> ''
        and song_name is not null
        and btrim(song_name) <> ''
      order by singer, song_name, scrape_time, scrape_date
    `),
  ]);

  const singerMap = new Map();
  const styles = new Set();

  for (const row of singerResult.rows) {
    const singer = cleanText(row.singer);
    if (!singer) continue;
    const current = singerMap.get(singer) || {
      singer,
      singerTag: "--",
      capturedSongs: 0,
      dailyStatus: "--",
      lastCaptureDate: "--",
      fans: 0,
      songCount: 0,
      style: "未标注",
      nextCaptureDate: "--",
      captureCompleteness: null,
      fanHistory: [],
      platformSongCount: 0,
      platformDataPoints: 0,
      latestTotalLikes: 0,
      latestPlatformCapture: "--",
    };
    const style = cleanText(row.genre) || "未标注";
    const fans = parseNumber(row.fans_count) || 0;
    styles.add(style);
    current.fanHistory.push({ date: row.scrape_date, fans, isMock: false });
    current.singerTag = cleanText(row.singer_tag) || "--";
    current.songCount = parseNumber(row.song_count) || 0;
    current.capturedSongs = current.songCount;
    current.fans = fans;
    current.style = style;
    current.lastCaptureDate = row.scrape_date;
    singerMap.set(singer, current);
  }

  const songsBySinger = {};
  for (const row of songResult.rows) {
    const singer = cleanText(row.singer);
    const songName = cleanText(row.song_name);
    const metric = parseSongMetric(row.song_data);
    songsBySinger[singer] ||= [];
    let song = songsBySinger[singer].find((item) => item.song === songName);
    if (!song) {
      song = { song: songName, singer, snapshots: [] };
      songsBySinger[singer].push(song);
    }
    song.snapshots.push({
      collectedAt: isoDateTime(row.scrape_time) || row.scrape_date,
      collectedAtLabel: dateTimeLabel(row.scrape_time) || row.scrape_date,
      date: row.scrape_date,
      likes: row.likes == null ? null : Number(row.likes),
      rawLikes: row.likes == null ? "--" : String(row.likes),
      singCount: row.play_count == null ? 0 : Number(row.play_count),
      metricRaw: metric.raw,
      metricType: metric.type,
      metricValue: metric.value,
      syncStatus: "--",
    });
  }

  for (const [singer, songs] of Object.entries(songsBySinger)) {
    const summary = singerMap.get(singer) || {
      singer,
      singerTag: "--",
      capturedSongs: 0,
      dailyStatus: "--",
      lastCaptureDate: "--",
      fans: 0,
      songCount: 0,
      style: "未标注",
      nextCaptureDate: "--",
      captureCompleteness: null,
      fanHistory: [],
      platformSongCount: 0,
      platformDataPoints: 0,
      latestTotalLikes: 0,
      latestPlatformCapture: "--",
    };

    let latestTotalLikes = 0;
    let latestCapture = "";
    let dataPoints = 0;
    for (const song of songs) {
      song.snapshots.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
      const valid = song.snapshots.filter((item) => item.likes !== null && item.likes !== undefined);
      const first = valid[0] || null;
      const latest = valid[valid.length - 1] || song.snapshots[song.snapshots.length - 1] || null;
      const latestLikes = latest?.likes ?? null;
      song.latestLikes = latestLikes;
      song.deltaLikes = latestLikes !== null && first?.likes !== null && first?.likes !== undefined ? latestLikes - first.likes : null;
      song.latestMetricRaw = latest?.metricRaw || "";
      song.latestMetricType = latest?.metricType || "空";
      song.latestCollectedAt = latest?.collectedAtLabel || "--";
      song.pointCount = song.snapshots.length;
      song.hasBadLikes = song.snapshots.some((item) => item.likes === null || item.likes === undefined);
      dataPoints += song.snapshots.length;
      if (latestLikes !== null) latestTotalLikes += latestLikes;
      if (latest?.date && latest.date > latestCapture) latestCapture = latest.date;
    }
    songs.sort((a, b) => (b.latestLikes ?? -1) - (a.latestLikes ?? -1));
    summary.platformSongCount = songs.length;
    summary.platformDataPoints = dataPoints;
    summary.latestTotalLikes = latestTotalLikes;
    summary.latestPlatformCapture = latestCapture || "--";
    singerMap.set(singer, summary);
  }

  const singers = [...singerMap.values()].sort((a, b) => {
    if (b.fans !== a.fans) return b.fans - a.fans;
    return b.latestTotalLikes - a.latestTotalLikes;
  });

  const range = rangeResult.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    source: "PostgreSQL static export",
    dateRange: {
      start: range.start || "",
      end: range.end || "",
    },
    styles: [...styles].sort(),
    singers,
    songsBySinger,
  };
}

async function main() {
  const data = await buildStaticData();
  await pool.end();

  const html = fs.readFileSync(path.join(MVP_DIR, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(MVP_DIR, "styles.css"), "utf8");
  const app = fs.readFileSync(path.join(MVP_DIR, "app.js"), "utf8");
  const dataScript = [
    `<script type="application/json" id="dashboard-data">${safeJson(data)}</script>`,
    `<script>window.FANQIE_STATIC_DATA = JSON.parse(document.getElementById("dashboard-data").textContent);</script>`,
  ].join("\n");

  const output = html
    .replace(/<link rel="stylesheet" href="\.\/styles\.css" \/>/, `<style>\n${css}\n</style>`)
    .replace(/<script src="\.\/app\.js"><\/script>/, `${dataScript}\n<script>\n${app}\n</script>`)
    .replace("刷新数据", "刷新页面数据")
    .replace("关闭服务", "关闭服务");

  fs.writeFileSync(OUTPUT, output, "utf8");
  console.log(`Wrote ${OUTPUT}`);
  console.log(`Singers: ${data.singers.length}`);
  console.log(`Songs: ${Object.values(data.songsBySinger).reduce((sum, songs) => sum + songs.length, 0)}`);
}

main().catch(async (error) => {
  await pool.end().catch(() => {});
  console.error(error);
  process.exit(1);
});
