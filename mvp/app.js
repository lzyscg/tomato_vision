const state = {
  data: {
    generatedAt: "",
    dateRange: { start: "", end: "" },
    styles: [],
    singers: [],
    songsBySinger: {},
  },
  filteredSingers: [],
  selectedSinger: null,
  selectedSong: null,
  search: "",
  style: "all",
  sortKey: "fanGrowth7d",
  sortDir: "desc",
  showAnnotations: true,
  dateStart: "",
  dateEnd: "",
  dateMin: "",
  dateMax: "",
  loading: false,
  loadedSongKey: "",
};

const STATIC_DATA = window.FANQIE_STATIC_DATA || null;
const els = {};

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return Number(value).toLocaleString("zh-CN");
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "--";
  return `${Number(value).toFixed(1)}%`;
}

function shortDateTime(value) {
  if (!value || value === "--") return "--";
  return value.replace("T", " ").slice(0, 16);
}

function deltaClass(value) {
  if (value > 0) return "delta-positive";
  if (value < 0) return "delta-negative";
  return "muted";
}

function debounce(fn, delay = 250) {
  let timer = null;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

function initElements() {
  [
    "dateRange",
    "generatedAt",
    "syncButton",
    "stopServerButton",
    "syncStatus",
    "singerCount",
    "snapshotCount",
    "badLikeCount",
    "currentSinger",
    "singerPage",
    "songPage",
    "startDateInput",
    "endDateInput",
    "resetDateButton",
    "searchInput",
    "styleFilter",
    "singerGrid",
    "fanTooltip",
    "backButton",
    "detailTitle",
    "detailMeta",
    "detailStats",
    "songCountLabel",
    "songTable",
    "chartTitle",
    "chartSubtitle",
    "annotationToggle",
    "lineChart",
    "emptyChart",
    "tooltip",
    "snapshotTable",
  ].forEach((id) => {
    els[id] = $(id);
  });
}

async function apiGet(path, params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") query.set(key, value);
  });
  const url = query.toString() ? `${path}?${query}` : path;
  const response = await fetch(url);
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.error || "数据库查询失败");
  }
  return payload;
}

async function loadMeta() {
  if (STATIC_DATA) {
    state.data.generatedAt = STATIC_DATA.generatedAt;
    state.data.dateRange = STATIC_DATA.dateRange;
    state.data.styles = STATIC_DATA.styles || [];
    state.dateMin = STATIC_DATA.dateRange.start || "";
    state.dateMax = STATIC_DATA.dateRange.end || "";
    state.dateStart = state.dateMin;
    state.dateEnd = state.dateMax;
    return;
  }

  const meta = await apiGet("/api/meta");
  state.data.generatedAt = meta.generatedAt;
  state.data.dateRange = meta.dateRange;
  state.data.styles = meta.styles || [];
  state.dateMin = meta.dateRange.start || "";
  state.dateMax = meta.dateRange.end || "";
  state.dateStart = state.dateMin;
  state.dateEnd = state.dateMax;
}

async function loadSingers({ keepSelection = true } = {}) {
  state.loading = true;
  els.syncStatus.textContent = STATIC_DATA ? "正在筛选本地快照" : "正在查询数据库";
  const selectedName = keepSelection ? state.selectedSinger?.singer : "";

  try {
    if (STATIC_DATA) {
      state.data.generatedAt = STATIC_DATA.generatedAt;
      state.data.dateRange = { start: state.dateStart, end: state.dateEnd };
      state.data.styles = STATIC_DATA.styles || state.data.styles;
      state.data.singers = filterStaticSingers();
      state.data.songsBySinger = STATIC_DATA.songsBySinger || {};
      state.loadedSongKey = songCacheKey();
    } else {
      const payload = await apiGet("/api/singers", {
        start: state.dateStart,
        end: state.dateEnd,
        search: state.search,
        style: state.style,
      });
      state.data.generatedAt = payload.generatedAt;
      state.data.dateRange = payload.dateRange;
      state.data.styles = payload.styles || state.data.styles;
      state.data.singers = payload.singers || [];
      state.data.songsBySinger = {};
      state.loadedSongKey = "";
    }

    if (selectedName) {
      state.selectedSinger = state.data.singers.find((item) => item.singer === selectedName) || null;
    } else {
      state.selectedSinger = null;
    }
    if (!state.selectedSinger) state.selectedSong = null;

    renderShell();
    renderSingerTable();
    els.syncStatus.textContent = STATIC_DATA
      ? `已筛选 ${formatNumber(state.data.singers.length)} 位歌手`
      : `已加载 ${formatNumber(state.data.singers.length)} 位歌手`;

    if (state.selectedSinger && els.songPage?.classList.contains("is-active")) {
      await loadSongsForSelected(true);
      renderDetail();
    }
  } catch (error) {
    els.syncStatus.textContent = error.message;
    throw error;
  } finally {
    state.loading = false;
  }
}

function filterStaticSingers() {
  const keyword = state.search.toLowerCase();
  return (STATIC_DATA.singers || [])
    .filter((singer) => {
      const matchSearch = !keyword || singer.singer.toLowerCase().includes(keyword);
      const matchStyle = state.style === "all" || singer.style === state.style;
      return matchSearch && matchStyle;
    })
    .map((singer) => {
      const songs = STATIC_DATA.songsBySinger?.[singer.singer] || [];
      const rangedSongs = songs.map((song) => ({
        song,
        snapshots: songSnapshotsInRange(song),
      })).filter((item) => item.snapshots.length);
      const latestTotalLikes = rangedSongs.reduce((sum, item) => {
        const valid = item.snapshots.filter((snapshot) => snapshot.likes !== null && snapshot.likes !== undefined);
        const latest = valid[valid.length - 1];
        return sum + (latest?.likes || 0);
      }, 0);
      const latestCapture = rangedSongs
        .flatMap((item) => item.snapshots.map((snapshot) => snapshot.date))
        .sort()
        .at(-1);

      return {
        ...singer,
        fanHistory: fanHistoryInRange(singer),
        platformSongCount: rangedSongs.length,
        platformDataPoints: rangedSongs.reduce((sum, item) => sum + item.snapshots.length, 0),
        latestTotalLikes,
        latestPlatformCapture: latestCapture || "--",
      };
    });
}

function songCacheKey(singerName = state.selectedSinger?.singer) {
  return `${singerName || ""}|${state.dateStart}|${state.dateEnd}`;
}

async function loadSongsForSelected(force = false) {
  if (!state.selectedSinger) return;
  const key = songCacheKey();
  if (!force && state.loadedSongKey === key && state.data.songsBySinger[state.selectedSinger.singer]) return;

  if (STATIC_DATA) {
    state.data.songsBySinger = STATIC_DATA.songsBySinger || {};
    state.loadedSongKey = key;
    const songs = state.data.songsBySinger[state.selectedSinger.singer] || [];
    if (!state.selectedSong || !songs.some((song) => song.song === state.selectedSong.song)) {
      state.selectedSong = songs[0] || null;
    } else {
      state.selectedSong = songs.find((song) => song.song === state.selectedSong.song) || songs[0] || null;
    }
    return;
  }

  els.songCountLabel.textContent = "正在查询歌曲";
  const payload = await apiGet("/api/songs", {
    singer: state.selectedSinger.singer,
    start: state.dateStart,
    end: state.dateEnd,
  });
  state.data.songsBySinger[state.selectedSinger.singer] = payload.songs || [];
  state.loadedSongKey = key;

  const songs = state.data.songsBySinger[state.selectedSinger.singer] || [];
  if (!state.selectedSong || !songs.some((song) => song.song === state.selectedSong.song)) {
    state.selectedSong = songs[0] || null;
  } else {
    state.selectedSong = songs.find((song) => song.song === state.selectedSong.song) || songs[0] || null;
  }
}

function setupControls() {
  setupDateControls();
  renderStyleOptions();

  if (STATIC_DATA) {
    els.syncButton.textContent = "刷新页面数据";
    els.stopServerButton.style.display = "none";
  }

  const runSingerQuery = debounce(() => {
    void loadSingers().catch(console.error);
  });

  els.searchInput.addEventListener("input", (event) => {
    state.search = event.target.value.trim();
    runSingerQuery();
  });

  els.styleFilter.addEventListener("change", (event) => {
    state.style = event.target.value;
    void loadSingers().catch(console.error);
  });

  els.singerGrid.addEventListener("mousemove", (event) => {
    const point = event.target.closest(".fan-dot-interactive");
    if (!point) {
      els.fanTooltip.hidden = true;
      return;
    }
    showFanTooltip(point, event);
  });

  els.singerGrid.addEventListener("mouseleave", () => {
    els.fanTooltip.hidden = true;
  });

  els.backButton.addEventListener("click", () => {
    showSingerPage();
  });

  els.resetDateButton.addEventListener("click", () => {
    void setDateRange(state.dateMin, state.dateMax);
  });

  els.annotationToggle.addEventListener("change", (event) => {
    state.showAnnotations = event.target.checked;
    renderChart();
  });

  els.syncButton?.addEventListener("click", refreshFromDatabase);
  els.stopServerButton?.addEventListener("click", stopLocalServer);

  window.addEventListener("resize", () => {
    renderSingerTable();
    renderChart();
  });
}

function renderStyleOptions() {
  els.styleFilter.innerHTML = `<option value="all">全部风格</option>`;
  state.data.styles.forEach((style) => {
    const option = document.createElement("option");
    option.value = style;
    option.textContent = style;
    els.styleFilter.appendChild(option);
  });
  els.styleFilter.value = state.style;
}

async function stopLocalServer() {
  els.syncStatus.textContent = "正在关闭服务";
  try {
    await fetch("/api/shutdown", { method: "POST" });
    els.syncStatus.textContent = "服务已关闭";
    els.syncButton.disabled = true;
    els.stopServerButton.disabled = true;
  } catch (error) {
    els.syncStatus.textContent = "关闭失败";
  }
}

async function refreshFromDatabase() {
  if (state.loading) return;
  els.syncButton.disabled = true;
  els.syncButton.textContent = STATIC_DATA ? "筛选中" : "查询中";
  try {
    await loadSingers();
    els.syncStatus.textContent = STATIC_DATA ? "本地快照已刷新" : "数据库数据已刷新";
  } catch (error) {
    els.syncStatus.textContent = error.message;
  } finally {
    els.syncButton.disabled = false;
    els.syncButton.textContent = STATIC_DATA ? "刷新页面数据" : "刷新数据";
  }
}

function setupDateControls() {
  [els.startDateInput, els.endDateInput].forEach((input) => {
    input.min = state.dateMin;
    input.max = state.dateMax;
  });
  els.startDateInput.value = state.dateStart;
  els.endDateInput.value = state.dateEnd;

  [els.startDateInput, els.endDateInput].forEach((input) => {
    input.addEventListener("change", () => {
      const start = els.startDateInput.value || state.dateMin;
      const end = els.endDateInput.value || state.dateMax;
      void setDateRange(start <= end ? start : end, start <= end ? end : start);
    });
  });
}

async function setDateRange(start, end) {
  state.dateStart = start;
  state.dateEnd = end;
  if (els.startDateInput) els.startDateInput.value = start;
  if (els.endDateInput) els.endDateInput.value = end;
  await loadSingers();
}

function renderShell() {
  const totalFans = state.data.singers.reduce((sum, singer) => sum + (singer.fans || 0), 0);
  const selectedPeriod = state.dateStart && state.dateEnd ? `${state.dateStart.slice(5)} 至 ${state.dateEnd.slice(5)}` : "--";
  els.dateRange.textContent = `查询区间 ${state.dateStart || "--"} 至 ${state.dateEnd || "--"}`;
  els.generatedAt.textContent = `查询时间 ${shortDateTime(state.data.generatedAt)}`;
  els.singerCount.textContent = formatNumber(state.data.singers.length);
  els.snapshotCount.textContent = formatNumber(totalFans);
  els.badLikeCount.textContent = selectedPeriod;
  els.currentSinger.textContent = state.selectedSinger?.singer || "--";
}

function getSingerValue(singer, key) {
  const value = singer[key];
  if (value === null || value === undefined) return key === "captureCompleteness" ? -1 : "";
  return value;
}

function fanGrowth(singer) {
  const history = fanHistoryInRange(singer);
  if (history.length < 2) return 0;
  return history[history.length - 1].fans - history[0].fans;
}

function inSelectedRange(date) {
  if (!date || date === "--") return false;
  return (!state.dateStart || date >= state.dateStart) && (!state.dateEnd || date <= state.dateEnd);
}

function fanHistoryInRange(singer) {
  return (singer.fanHistory || []).filter((point) => inSelectedRange(point.date));
}

function songSnapshotsInRange(song) {
  return (song.snapshots || []).filter((point) => inSelectedRange(point.date));
}

function songSummaryInRange(song) {
  const snapshots = songSnapshotsInRange(song);
  const validSnapshots = snapshots.filter((item) => item.likes !== null && item.likes !== undefined);
  const first = validSnapshots[0] || null;
  const latest = validSnapshots[validSnapshots.length - 1] || snapshots[snapshots.length - 1] || null;
  const latestLikes = latest && latest.likes !== null && latest.likes !== undefined ? latest.likes : null;
  const deltaLikes = latestLikes !== null && first ? latestLikes - first.likes : null;
  return {
    snapshots,
    latest,
    latestLikes,
    deltaLikes,
    pointCount: snapshots.length,
  };
}

function compareDeltaDesc(a, b) {
  const av = a === null || a === undefined ? Number.NEGATIVE_INFINITY : a;
  const bv = b === null || b === undefined ? Number.NEGATIVE_INFINITY : b;
  return bv - av;
}

function sortSongsByRangeDelta(songs) {
  return [...songs].sort((a, b) => {
    const aSummary = songSummaryInRange(a);
    const bSummary = songSummaryInRange(b);
    const deltaCompare = compareDeltaDesc(aSummary.deltaLikes, bSummary.deltaLikes);
    if (deltaCompare !== 0) return deltaCompare;

    const latestCompare = compareDeltaDesc(aSummary.latestLikes, bSummary.latestLikes);
    if (latestCompare !== 0) return latestCompare;

    return a.song.localeCompare(b.song, "zh-CN");
  });
}

function renderSingerTable() {
  state.filteredSingers = [...state.data.singers].sort((a, b) => {
    const av = state.sortKey === "fanGrowth7d" ? fanGrowth(a) : getSingerValue(a, state.sortKey);
    const bv = state.sortKey === "fanGrowth7d" ? fanGrowth(b) : getSingerValue(b, state.sortKey);
    const result = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), "zh-CN");
    return state.sortDir === "asc" ? result : -result;
  });

  els.singerGrid.innerHTML = "";

  if (!state.filteredSingers.length) {
    els.singerGrid.innerHTML = `<div class="empty-state">当前筛选条件下没有歌手数据</div>`;
    return;
  }

  state.filteredSingers.forEach((singer) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = `singer-card ${singer.singer === state.selectedSinger?.singer ? "is-active" : ""}`;
    const growth = fanGrowth(singer);
    const history = fanHistoryInRange(singer);
    const singerName = escapeHtml(singer.singer);
    card.innerHTML = `
      <div class="singer-card-head">
        <div class="avatar">${escapeHtml(avatarText(singer.singer))}</div>
        <div class="singer-title-block">
          <div class="singer-name" title="${singerName}">${singerName}</div>
          <div class="singer-subline"><span class="pill">${escapeHtml(singer.style)}</span><span>${escapeHtml(singer.dailyStatus)}</span></div>
        </div>
      </div>
      <div class="singer-card-metrics">
        <div><span>粉丝数</span><strong>${formatNumber(singer.fans)}</strong></div>
        <div><span>区间净增</span><strong class="${deltaClass(growth)}">${growth >= 0 ? "+" : ""}${formatNumber(growth)}</strong></div>
        <div><span>歌曲快照</span><strong>${formatNumber(singer.platformDataPoints)}</strong></div>
      </div>
      ${renderSingerTrend(history, growth)}
    `;
    card.addEventListener("click", () => {
      void selectSinger(singer.singer);
    });
    els.singerGrid.appendChild(card);
  });
}

function avatarText(name) {
  return (name || "--").trim().slice(0, 2);
}

function renderSingerTrend(points, growth) {
  if (!points.length) return `<div class="singer-trend-empty">当前日期范围暂无粉丝数据</div>`;
  const width = 320;
  const height = 130;
  const left = 12;
  const right = 12;
  const top = 22;
  const bottom = 32;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const values = points.map((item) => item.fans);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const yMin = minY === maxY ? Math.max(0, minY - 1) : minY;
  const yMax = minY === maxY ? maxY + 1 : maxY;
  const xFor = (index) => left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const yFor = (value) => top + (1 - (value - yMin) / (yMax - yMin)) * plotH;
  const line = points.map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index).toFixed(1)} ${yFor(point.fans).toFixed(1)}`).join(" ");
  const area = `M ${xFor(0).toFixed(1)} ${height - bottom} ${points.map((point, index) => `L ${xFor(index).toFixed(1)} ${yFor(point.fans).toFixed(1)}`).join(" ")} L ${xFor(points.length - 1).toFixed(1)} ${height - bottom} Z`;
  const first = points[0];
  const last = points[points.length - 1];
  const firstX = xFor(0);
  const firstY = yFor(first.fans);
  const lastX = xFor(points.length - 1);
  const lastY = yFor(last.fans);
  const pointMarkers = points.map((point, index) => {
    const x = xFor(index);
    const y = yFor(point.fans);
    const isEdge = index === 0 || index === points.length - 1;
    return `
      <g class="fan-point-group">
        <circle class="sparkline-dot fan-dot-interactive ${index === 0 ? "start" : ""} ${isEdge ? "important" : ""}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isEdge ? 4 : 2.9}" data-date="${escapeHtml(point.date)}" data-fans="${formatNumber(point.fans)}"></circle>
      </g>
    `;
  }).join("");
  return `
    <div class="singer-trend-wrap">
      <div class="trend-caption">
        <span>${first.date.slice(5)} ${formatNumber(first.fans)}</span>
        <strong class="${deltaClass(growth)}">${growth >= 0 ? "+" : ""}${formatNumber(growth)}</strong>
        <span>${last.date.slice(5)} ${formatNumber(last.fans)}</span>
      </div>
      <svg class="singer-trend-chart" viewBox="0 0 ${width} ${height}" aria-label="粉丝趋势图">
        <path class="sparkline-area" d="${area}"></path>
        <path class="sparkline-path" d="${line}"></path>
        ${pointMarkers}
        <text class="trend-point-label start" x="${Math.max(28, firstX).toFixed(1)}" y="${Math.max(12, firstY - 8).toFixed(1)}" text-anchor="middle">${formatNumber(first.fans)}</text>
        <text class="trend-point-label" x="${Math.min(width - 36, lastX).toFixed(1)}" y="${Math.max(12, lastY - 8).toFixed(1)}" text-anchor="middle">${formatNumber(last.fans)}</text>
        <text class="trend-date-label" x="${Math.max(16, firstX).toFixed(1)}" y="${height - 7}" text-anchor="middle">${first.date.slice(5)}</text>
        <text class="trend-date-label" x="${Math.min(width - 16, lastX).toFixed(1)}" y="${height - 7}" text-anchor="middle">${last.date.slice(5)}</text>
      </svg>
    </div>
  `;
}

async function selectSinger(singerName) {
  state.selectedSinger = state.data.singers.find((item) => item.singer === singerName);
  state.selectedSong = null;
  renderSingerTable();
  showSongPage();
  await loadSongsForSelected(true);
  renderDetail();
}

function showSingerPage() {
  els.singerPage.classList.add("is-active");
  els.songPage.classList.remove("is-active");
  els.currentSinger.textContent = state.selectedSinger?.singer || "--";
  renderSingerTable();
}

function showSongPage() {
  els.singerPage.classList.remove("is-active");
  els.songPage.classList.add("is-active");
  renderChart();
}

function renderDetail() {
  const singer = state.selectedSinger;
  if (!singer) return;

  const songs = state.data.songsBySinger[singer.singer] || [];
  els.currentSinger.textContent = singer.singer;
  els.detailTitle.textContent = singer.singer;
  els.detailMeta.innerHTML = `
    <span class="pill">${escapeHtml(singer.style)}</span>
    <span>上次抓取 ${escapeHtml(singer.lastCaptureDate)}</span>
    <span>最新快照 ${escapeHtml(singer.latestPlatformCapture)}</span>
  `;
  els.detailStats.innerHTML = `
    <div class="stat"><span>粉丝数</span><strong>${formatNumber(singer.fans)}</strong></div>
    <div class="stat"><span>区间粉丝净增</span><strong class="${deltaClass(fanGrowth(singer))}">${fanGrowth(singer) >= 0 ? "+" : ""}${formatNumber(fanGrowth(singer))}</strong></div>
    <div class="stat"><span>已抓取</span><strong>${formatNumber(singer.capturedSongs || singer.platformSongCount)}</strong></div>
    <div class="stat"><span>抓取完整度</span><strong>${formatPercent(singer.captureCompleteness)}</strong></div>
    <div class="stat"><span>最新收藏合计</span><strong>${formatNumber(singer.latestTotalLikes)}</strong></div>
  `;
  const rangedSongs = sortSongsByRangeDelta(songs.filter((song) => songSnapshotsInRange(song).length));
  if (!state.selectedSong || !songSnapshotsInRange(state.selectedSong).length) {
    state.selectedSong = rangedSongs[0] || songs[0] || null;
  }
  els.songCountLabel.textContent = `${formatNumber(rangedSongs.length)} 首歌有区间数据`;

  renderSongTable(rangedSongs);
  renderChart();
  renderSnapshotTable();
}

function renderSongTable(songs) {
  const tbody = els.songTable.querySelector("tbody");
  tbody.innerHTML = "";

  if (!songs.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="muted">当前日期范围内暂无歌曲快照</td>`;
    tbody.appendChild(tr);
    return;
  }

  songs.forEach((song) => {
    const tr = document.createElement("tr");
    tr.className = song.song === state.selectedSong?.song ? "is-active" : "";
    const summary = songSummaryInRange(song);
    const delta = summary.deltaLikes === null || summary.deltaLikes === undefined ? "--" : `${summary.deltaLikes >= 0 ? "+" : ""}${formatNumber(summary.deltaLikes)}`;
    tr.innerHTML = `
      <td><div class="song-cell" title="${escapeHtml(song.song)}">${escapeHtml(song.song)}</div><div class="muted">${escapeHtml(summary.latest?.collectedAtLabel || "--")}</div></td>
      <td class="numeric">${formatNumber(summary.latestLikes)}</td>
      <td class="numeric ${deltaClass(summary.deltaLikes)}">${delta}</td>
      <td>${summary.latest?.metricRaw ? escapeHtml(summary.latest.metricRaw) : "<span class='muted'>--</span>"}</td>
      <td class="numeric">${formatNumber(summary.pointCount)}</td>
    `;
    tr.addEventListener("click", () => {
      state.selectedSong = song;
      renderSongTable(songs);
      renderChart();
      renderSnapshotTable();
    });
    tbody.appendChild(tr);
  });
}

function chartBounds(svg = els.lineChart, height = 390) {
  const rect = svg.getBoundingClientRect();
  const width = Math.max(rect.width, 460);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { width, height, left: 56, right: 24, top: 34, bottom: 50 };
}

function renderChart() {
  const svg = els.lineChart;
  svg.innerHTML = "";
  els.tooltip.hidden = true;

  const song = state.selectedSong;
  if (!song || !song.snapshots?.length) {
    els.emptyChart.style.display = "grid";
    els.emptyChart.textContent = state.selectedSinger ? "正在等待歌曲数据" : "请选择一位歌手";
    els.chartTitle.textContent = "收藏趋势";
    els.chartSubtitle.textContent = "点击歌曲后查看折线图";
    return;
  }

  const points = songSnapshotsInRange(song).filter((item) => item.likes !== null && item.likes !== undefined);
  if (!points.length) {
    els.emptyChart.style.display = "grid";
    els.emptyChart.textContent = "当前日期范围内暂无有效收藏数据";
    els.chartTitle.textContent = song.song;
    els.chartSubtitle.textContent = `${state.dateStart} 至 ${state.dateEnd}`;
    return;
  }

  els.emptyChart.style.display = "none";
  els.chartTitle.textContent = song.song;
  els.chartSubtitle.textContent = `${state.selectedSinger.singer} · ${state.dateStart} 至 ${state.dateEnd} · ${formatNumber(points.length)} 个采集点`;

  const box = chartBounds();
  const plotW = box.width - box.left - box.right;
  const plotH = box.height - box.top - box.bottom;
  const values = points.map((item) => item.likes);
  const minY = Math.min(...values);
  const maxY = Math.max(...values);
  const padding = Math.max(10, Math.round((maxY - minY) * 0.12));
  const yMin = Math.max(0, minY - padding);
  const yMax = maxY + padding || 1;

  const xFor = (index) => box.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const yFor = (value) => box.top + (1 - (value - yMin) / (yMax - yMin)) * plotH;

  for (let i = 0; i <= 4; i += 1) {
    const y = box.top + (i / 4) * plotH;
    const value = yMax - (i / 4) * (yMax - yMin);
    svg.appendChild(svgEl("line", { x1: box.left, x2: box.width - box.right, y1: y, y2: y, class: "grid-line" }));
    svg.appendChild(svgText(formatNumber(Math.round(value)), box.left - 10, y + 4, "axis-label", "end"));
  }

  points.forEach((point, index) => {
    const x = xFor(index);
    const label = point.date?.slice(5) || `${index + 1}`;
    svg.appendChild(svgText(label, x, box.height - 22, "axis-label", "middle"));
  });

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${xFor(index)} ${yFor(point.likes)}`)
    .join(" ");
  svg.appendChild(svgEl("path", { d: path, class: "line-path" }));

  points.forEach((point, index) => {
    const x = xFor(index);
    const y = yFor(point.likes);
    const circle = svgEl("circle", { cx: x, cy: y, r: 4.8, class: "point" });
    circle.addEventListener("mouseenter", () => showTooltip(point, x, y));
    circle.addEventListener("mousemove", () => showTooltip(point, x, y));
    circle.addEventListener("mouseleave", () => {
      els.tooltip.hidden = true;
    });
    svg.appendChild(circle);

    if (state.showAnnotations) {
      renderAnnotation(svg, point, x, y, index);
    }
  });
}

function svgEl(name, attrs) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, value));
  return el;
}

function svgText(text, x, y, className, anchor = "start") {
  const el = svgEl("text", { x, y, class: className, "text-anchor": anchor });
  el.textContent = text;
  return el;
}

function renderAnnotation(svg, point, x, y, index) {
  const likesLabel = `${formatNumber(point.likes)} 收藏`;
  const metricLabel = point.metricRaw ? `热度 ${point.metricRaw}` : "热度 --";
  const width = 106;
  const height = 42;
  const svgWidth = svg.viewBox.baseVal.width || svg.getBoundingClientRect().width || 460;
  const svgHeight = svg.viewBox.baseVal.height || svg.getBoundingClientRect().height || 390;
  const clearance = 16;
  const topMargin = 8;
  const bottomMargin = 38;
  const aboveY = y - height - clearance;
  const belowY = y + clearance;
  const canPlaceAbove = aboveY >= topMargin;
  const canPlaceBelow = belowY + height <= svgHeight - bottomMargin;
  let rectY;

  if (index % 2 === 0 && canPlaceAbove) {
    rectY = aboveY;
  } else if (index % 2 === 1 && canPlaceBelow) {
    rectY = belowY;
  } else if (canPlaceAbove) {
    rectY = aboveY;
  } else if (canPlaceBelow) {
    rectY = belowY;
  } else {
    rectY = Math.max(topMargin, Math.min(svgHeight - bottomMargin - height, aboveY));
  }

  const rectX = Math.max(6, Math.min(svgWidth - width - 6, x - width / 2));
  const leaderStartY = rectY > y ? y + 6 : y - 6;
  const leaderEndY = rectY > y ? rectY : rectY + height;
  const group = svgEl("g", { class: "annotation" });
  const leader = svgEl("line", {
    x1: x,
    y1: leaderStartY,
    x2: x,
    y2: leaderEndY,
    class: "annotation-leader",
  });
  const rect = svgEl("rect", {
    x: rectX,
    y: rectY,
    width,
    height,
    rx: 6,
  });
  const mainText = svgText(likesLabel, rectX + 9, rectY + 17, "annotation-main", "start");
  const shortMetric = metricLabel.length > 12 ? `${metricLabel.slice(0, 12)}...` : metricLabel;
  const subText = svgText(shortMetric, rectX + 9, rectY + 33, "annotation-sub", "start");
  group.appendChild(leader);
  group.appendChild(rect);
  group.appendChild(mainText);
  group.appendChild(subText);
  svg.appendChild(group);
}

function showTooltip(point, x, y) {
  els.tooltip.hidden = false;
  els.tooltip.innerHTML = `
    <strong>${escapeHtml(state.selectedSong.song)}</strong>
    <div>采集时间：${escapeHtml(point.collectedAtLabel)}</div>
    <div>收藏量：${formatNumber(point.likes)}</div>
    <div>歌曲数据：${escapeHtml(point.metricRaw || "--")}</div>
    <div>演唱数：${formatNumber(point.singCount)}</div>
    <div>同步状态：${escapeHtml(point.syncStatus)}</div>
  `;

  const chartRect = els.lineChart.getBoundingClientRect();
  const xPos = Math.min(chartRect.width - 230, Math.max(12, x + 12));
  const yPos = Math.max(12, y - 34);
  els.tooltip.style.left = `${xPos}px`;
  els.tooltip.style.top = `${yPos}px`;
}

function showFanTooltip(pointEl, event) {
  els.fanTooltip.hidden = false;
  els.fanTooltip.innerHTML = `
    <strong>粉丝数 ${escapeHtml(pointEl.dataset.fans)}</strong>
    <div>日期：${escapeHtml(pointEl.dataset.date)}</div>
  `;
  const xPos = Math.min(window.innerWidth - 230, Math.max(12, event.clientX + 14));
  const yPos = Math.max(12, event.clientY - 44);
  els.fanTooltip.style.left = `${xPos}px`;
  els.fanTooltip.style.top = `${yPos}px`;
}

function renderSnapshotTable() {
  const song = state.selectedSong;
  if (!song) {
    els.snapshotTable.innerHTML = "";
    return;
  }

  const rows = songSnapshotsInRange(song).slice().reverse();
  els.snapshotTable.innerHTML = `
    <table class="snapshot-grid">
      <thead>
        <tr>
          <th>采集时间</th>
          <th class="numeric">收藏量</th>
          <th>歌曲数据</th>
          <th class="numeric">演唱数</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((item) => `
          <tr>
            <td>${escapeHtml(item.collectedAtLabel)}</td>
            <td class="numeric">${formatNumber(item.likes)}</td>
            <td>${item.metricRaw ? escapeHtml(item.metricRaw) : "<span class='muted'>--</span>"}</td>
            <td class="numeric">${formatNumber(item.singCount)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function boot() {
  initElements();
  try {
    await loadMeta();
    setupControls();
    await loadSingers({ keepSelection: false });
    const firstSinger = state.data.singers.find((item) => item.platformDataPoints > 0) || state.data.singers[0];
    if (firstSinger) state.selectedSinger = firstSinger;
    els.currentSinger.textContent = state.selectedSinger?.singer || "--";
    renderSingerTable();
  } catch (error) {
    document.body.innerHTML = `<main class="app-shell"><div class="empty-state">${escapeHtml(error.message)}</div></main>`;
    console.error(error);
  }
}

boot();
