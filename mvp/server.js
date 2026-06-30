import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const __filename = fileURLToPath(import.meta.url);
const MVP_DIR = path.dirname(__filename);
const ROOT_DIR = path.dirname(MVP_DIR);
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || process.argv[2] || 5173);

loadEnv(path.join(ROOT_DIR, ".env.local"));
if (process.resourcesPath) loadEnv(path.join(process.resourcesPath, ".env.local"));
loadEnv(path.join(process.cwd(), ".env.local"));

const dbConfig = {
  host: process.env.PGHOST || process.env.DB_HOST || "10.128.1.3",
  port: Number(process.env.PGPORT || process.env.DB_PORT || 5432),
  database: process.env.PGDATABASE || process.env.DB_NAME || "qiyin_warehouse",
  user: process.env.PGUSER || process.env.DB_USER || "dbuser_view",
  password: process.env.PGPASSWORD || process.env.DB_PASSWORD,
  ssl: parseSsl(process.env.PGSSL || process.env.DB_SSL || "prefer"),
  max: Number(process.env.PGPOOL_MAX || 6),
  connectionTimeoutMillis: 8000,
};

if (!dbConfig.password) {
  console.error("缺少数据库密码：请在 .env.local 中配置 PGPASSWORD。");
}

const pool = new Pool(dbConfig);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

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

function jsonResponse(res, payload, status = 200) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function errorResponse(res, error, status = 500) {
  console.error(error);
  jsonResponse(res, { ok: false, error: error.message || "服务异常" }, status);
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

function dateOnly(value) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function dateTimeLabel(value) {
  if (!value) return "--";
  return String(value).replace("T", " ").slice(0, 19);
}

function isoDateTime(value) {
  if (!value) return "";
  return String(value).replace(" ", "T").slice(0, 19);
}

function isDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

async function getMeta() {
  const [rangeResult, stylesResult] = await Promise.all([
    pool.query(`
      select min(scrape_date)::text as start, max(scrape_date)::text as "end"
      from (
        select scrape_date from ods.ods_scrap_fanqie_singers_df
        union all
        select scrape_date from ods.ods_scrap_fanqie_song_list_df
      ) dates
    `),
    pool.query(`
      select distinct genre as style
      from ods.ods_scrap_fanqie_singers_df
      where genre is not null and btrim(genre) <> ''
      order by genre
    `),
  ]);

  const range = rangeResult.rows[0] || {};
  return {
    generatedAt: new Date().toISOString(),
    dateRange: {
      start: range.start || "",
      end: range.end || "",
    },
    styles: stylesResult.rows.map((row) => row.style),
  };
}

function normalizedRange(searchParams, meta) {
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const fallbackStart = meta.dateRange.start;
  const fallbackEnd = meta.dateRange.end;
  return {
    start: isDate(start) ? start : fallbackStart,
    end: isDate(end) ? end : fallbackEnd,
  };
}

async function getSingers(searchParams) {
  const meta = await getMeta();
  const { start, end } = normalizedRange(searchParams, meta);
  const search = cleanText(searchParams.get("search")).toLowerCase();
  const style = cleanText(searchParams.get("style"));

  const params = [start, end];
  const where = ["scrape_date between $1::date and $2::date"];
  if (search) {
    params.push(`%${search}%`);
    where.push(`lower(singer) like $${params.length}`);
  }
  if (style && style !== "all") {
    params.push(style);
    where.push(`genre = $${params.length}`);
  }

  const singerRows = await pool.query(
    `
      select scrape_date::text as scrape_date, singer, singer_tag, song_count, fans_count, genre
      from ods.ods_scrap_fanqie_singers_df
      where ${where.join(" and ")}
      order by singer, scrape_date
    `,
    params,
  );

  const bySinger = new Map();
  for (const row of singerRows.rows) {
    const singer = cleanText(row.singer);
    if (!singer) continue;
    const current = bySinger.get(singer) || {
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
    const fans = parseNumber(row.fans_count) || 0;
    current.fanHistory.push({ date: row.scrape_date, fans, isMock: false });
    current.singerTag = cleanText(row.singer_tag) || "--";
    current.songCount = parseNumber(row.song_count) || 0;
    current.capturedSongs = current.songCount;
    current.fans = fans;
    current.style = cleanText(row.genre) || "未标注";
    current.lastCaptureDate = row.scrape_date;
    bySinger.set(singer, current);
  }

  const singerNames = [...bySinger.keys()];
  if (singerNames.length) {
    const [songStats, latestLikeStats] = await Promise.all([
      pool.query(
        `
          select singer,
                 count(*)::int as data_points,
                 count(distinct song_name)::int as platform_song_count,
                 max(scrape_date)::text as latest_capture
          from ods.ods_scrap_fanqie_song_list_df
          where scrape_date between $1::date and $2::date
            and singer = any($3::text[])
          group by singer
        `,
        [start, end, singerNames],
      ),
      pool.query(
        `
          select singer, coalesce(sum(likes), 0)::int as latest_total_likes
          from (
            select distinct on (singer, song_name)
                   singer, song_name, likes
            from ods.ods_scrap_fanqie_song_list_df
            where scrape_date between $1::date and $2::date
              and singer = any($3::text[])
              and likes is not null
            order by singer, song_name, scrape_time desc nulls last, scrape_date desc
          ) latest
          group by singer
        `,
        [start, end, singerNames],
      ),
    ]);

    for (const row of songStats.rows) {
      const item = bySinger.get(row.singer);
      if (!item) continue;
      item.platformSongCount = Number(row.platform_song_count) || 0;
      item.platformDataPoints = Number(row.data_points) || 0;
      item.latestPlatformCapture = row.latest_capture || "--";
    }

    for (const row of latestLikeStats.rows) {
      const item = bySinger.get(row.singer);
      if (!item) continue;
      item.latestTotalLikes = Number(row.latest_total_likes) || 0;
    }
  }

  const singers = [...bySinger.values()].sort((a, b) => {
    if (b.fans !== a.fans) return b.fans - a.fans;
    return b.latestTotalLikes - a.latestTotalLikes;
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dateRange: { start, end },
    styles: meta.styles,
    singers,
  };
}

async function getSongs(searchParams) {
  const singer = cleanText(searchParams.get("singer"));
  if (!singer) {
    const error = new Error("缺少 singer 参数");
    error.status = 400;
    throw error;
  }

  const meta = await getMeta();
  const { start, end } = normalizedRange(searchParams, meta);
  const search = cleanText(searchParams.get("search")).toLowerCase();
  const params = [singer, start, end];
  const where = [
    "singer = $1",
    "scrape_date between $2::date and $3::date",
    "song_name is not null",
    "btrim(song_name) <> ''",
  ];
  if (search) {
    params.push(`%${search}%`);
    where.push(`lower(song_name) like $${params.length}`);
  }

  const result = await pool.query(
    `
      select scrape_date::text as scrape_date,
             singer,
             song_name,
             song_data,
             likes,
             play_count,
             scrape_time::text as scrape_time,
             create_time::text as create_time
      from ods.ods_scrap_fanqie_song_list_df
      where ${where.join(" and ")}
      order by song_name, scrape_time, scrape_date
    `,
    params,
  );

  const bySong = new Map();
  for (const row of result.rows) {
    const songName = cleanText(row.song_name);
    if (!songName) continue;
    const song = bySong.get(songName) || {
      song: songName,
      singer,
      snapshots: [],
    };
    const metric = parseSongMetric(row.song_data);
    const collectedAt = isoDateTime(row.scrape_time) || row.scrape_date;
    song.snapshots.push({
      collectedAt,
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
    bySong.set(songName, song);
  }

  const songs = [...bySong.values()].map((song) => {
    song.snapshots.sort((a, b) => a.collectedAt.localeCompare(b.collectedAt));
    const valid = song.snapshots.filter((item) => item.likes != null);
    const first = valid[0] || null;
    const latest = valid[valid.length - 1] || song.snapshots[song.snapshots.length - 1] || null;
    const latestLikes = latest?.likes ?? null;
    return {
      ...song,
      latestLikes,
      deltaLikes: latestLikes != null && first?.likes != null ? latestLikes - first.likes : null,
      latestMetricRaw: latest?.metricRaw || "",
      latestMetricType: latest?.metricType || "空",
      latestCollectedAt: latest?.collectedAtLabel || "--",
      pointCount: song.snapshots.length,
      hasBadLikes: song.snapshots.some((item) => item.likes == null),
    };
  });

  songs.sort((a, b) => {
    const likes = (b.latestLikes ?? -1) - (a.latestLikes ?? -1);
    if (likes !== 0) return likes;
    return (b.deltaLikes ?? -1) - (a.deltaLikes ?? -1);
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    dateRange: { start, end },
    singer,
    songs,
  };
}

async function handleApi(req, res, url) {
  try {
    if (url.pathname === "/api/meta" && req.method === "GET") {
      jsonResponse(res, { ok: true, ...(await getMeta()) });
      return;
    }

    if (url.pathname === "/api/singers" && req.method === "GET") {
      jsonResponse(res, await getSingers(url.searchParams));
      return;
    }

    if (url.pathname === "/api/songs" && req.method === "GET") {
      jsonResponse(res, await getSongs(url.searchParams));
      return;
    }

    if (url.pathname === "/api/shutdown" && req.method === "POST") {
      jsonResponse(res, { ok: true });
      setTimeout(() => process.exit(0), 50);
      return;
    }

    jsonResponse(res, { ok: false, error: "Not found" }, 404);
  } catch (error) {
    errorResponse(res, error, error.status || 500);
  }
}

function serveStatic(req, res, url) {
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(MVP_DIR, pathname));
  if (!filePath.startsWith(MVP_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const contentType = MIME_TYPES[path.extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

export function startServer({ host = HOST, port = PORT } = {}) {
  const server = http.createServer((req, res) => {
    const address = server.address();
    const activePort = typeof address === "object" && address ? address.port : port;
    const url = new URL(req.url || "/", `http://${host}:${activePort}`);
    if (url.pathname.startsWith("/api/")) {
      void handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      const address = server.address();
      const activePort = typeof address === "object" && address ? address.port : port;
      const url = `http://${host}:${activePort}/`;
      console.log(`Fanqie dashboard server: ${url}`);
      resolve({ server, url, port: activePort });
    });
  });
}

export async function stopDatabasePool() {
  await pool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer({ port: PORT }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
