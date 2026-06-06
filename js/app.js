/**
 * Vocaloid Weekly Ranking — app.js
 *
 * ■ スプレッドシートに入力する列（rankingシート）
 *   year, month, week, title, artist, videoId, views, viewsIncrease
 *   ※ rank / previousRank / isNew はすべてここで自動計算します
 *
 * ■ 設定は下の CONFIG だけ変更してください
 */

// ===================================================
// ★ 設定
// ===================================================
const CONFIG = {
  SHEET_URLS: {
  ranking:   'https://docs.google.com/spreadsheets/d/10QnXpQZUR0so22mKDDvPokgoej1x74aUXlV58X_bwVE/export?format=csv&gid=0',
  untracked: 'https://docs.google.com/spreadsheets/d/10QnXpQZUR0so22mKDDvPokgoej1x74aUXlV58X_bwVE/export?format=csv&gid=4023481',
  requests:  'https://docs.google.com/spreadsheets/d/10QnXpQZUR0so22mKDDvPokgoej1x74aUXlV58X_bwVE/export?format=csv&gid=1957443852',
  },
  THRESHOLDS: {
    MILLION: 1_000_000,
    HALF:      500_000,
    THIRD:     300_000,
  },
  // チャートに表示する最大週数
  CHART_WEEKS: 8,
  // チャートに表示する最大曲数（上位N曲）
  CHART_TOP_N: 10,
};
// ===================================================

// ===== 状態 =====
const State = {
  // 生データ（CSVから読んだまま）
  rawRanking:   [],  // [{year,month,week,title,artist,videoId,views,viewsIncrease}, ...]
  allUntracked: [],
  allRequests:  [],

  // 計算済みランキング（rank / previousRank / isNew 付き）
  // Map<periodKey, entry[]>  例: "2025|8|1" → [...]
  computed: new Map(),

  year:  null,
  month: null,
  week:  null,
  showTotalViews: false,
  showDetailViews: false,
  chartVisible: false,
  chartSongFilter: null,   // null = 上位N曲全体, string = 曲キー

  get periods() {
    const set = new Set(State.rawRanking.map(r => `${r.year}|${r.month}|${r.week}`));
    return [...set]
      .map(k => { const [y,m,w] = k.split('|'); return {y, m: Number(m), w: Number(w), key: k}; })
      .sort((a,b) => a.y!==b.y ? a.y.localeCompare(b.y) : a.m!==b.m ? a.m-b.m : a.w-b.w);
  },

  get years()  { return [...new Set(State.periods.map(p => p.y))]; },
  get months() { return [...new Set(State.periods.filter(p => p.y==State.year).map(p => p.m))]; },
  get weeks()  {
    return [...new Set(
      State.periods.filter(p => p.y==State.year && p.m==Number(State.month)).map(p => p.w)
    )];
  },

  get currentKey() { return `${State.year}|${State.month}|${State.week}`; },
  get currentRanking()   { return State.computed.get(State.currentKey) ?? []; },
  get currentUntracked() { return State.allUntracked.filter(r => r.year==State.year && r.month==State.month && r.week==State.week); },
  get currentRequests()  { return State.allRequests.filter(r => r.year==State.year && r.month==State.month && r.week==State.week); },
};

// ===================================================
// CSV パース
// ===================================================
function parseCSV(text) {
  const rows = [];
  let col = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], nx = text[i+1];
    if (inQ) {
      if (c==='"' && nx==='"') { col+='"'; i++; }
      else if (c==='"') { inQ=false; }
      else { col+=c; }
    } else {
      if (c==='"') { inQ=true; }
      else if (c===',') { row.push(col.trim()); col=''; }
      else if (c==='\n'||c==='\r') {
        row.push(col.trim()); col='';
        if (row.some(x=>x)) rows.push(row);
        row=[];
        if (c==='\r'&&nx==='\n') i++;
      } else { col+=c; }
    }
  }
  if (col||row.length) { row.push(col.trim()); if(row.some(x=>x)) rows.push(row); }
  return rows;
}

function csvToObjects(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.toLowerCase().replace(/\s/g,''));
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h,i) => obj[h] = (row[i]??'').trim());
    return obj;
  });
}

// ===================================================
// 生データ → 構造体
// ===================================================
function parseRankingRow(r) {
  const year  = String(r['year']  ?? r['年']  ?? '').trim();
  const month = String(r['month'] ?? r['月']  ?? '').trim();
  const week  = String(r['week']  ?? r['週']  ?? '').trim();
  const viewsIncrease = Number((r['viewsincrease'] ?? r['週間増加数'] ?? '0').replace(/,/g,''));
  if (!year || !month || !week || isNaN(viewsIncrease)) return null;
  return {
    year, month, week,
    title:   (r['title']  ?? r['曲名']  ?? '').trim(),
    artist:  (r['artist'] ?? r['アーティスト'] ?? '').trim(),
    videoId: (r['videoid']?? r['動画id'] ?? '').trim(),
    views:   Number((r['views'] ?? r['累計再生数'] ?? '0').replace(/,/g,'')),
    viewsIncrease,
  };
}

function parseUntrackedRow(r) {
  return {
    year: String(r['year']??r['年']??'').trim(),
    month:String(r['month']??r['月']??'').trim(),
    week: String(r['week']??r['週']??'').trim(),
    title:  (r['title'] ??r['曲名']??'').trim(),
    artist: (r['artist']??r['アーティスト']??'').trim(),
    videoId:(r['videoid']??r['動画id']??'').trim(),
    note:   (r['note']  ??r['備考']??'').trim(),
  };
}

function parseRequestRow(r) {
  return {
    year: String(r["year"]??r["年"]??"").trim(),
    month:String(r["month"]??r["月"]??"").trim(),
    week: String(r["week"]??r["週"]??"").trim(),
    title:    (r["title"]    ??r["曲名"]       ??"").trim(),
    artist:   (r["artist"]   ??r["アーティスト"]??"").trim(),
    videoId:  (r["videoid"]  ??r["動画id"]      ??"").trim(),
    views:    Number((r["views"]        ??r["累計再生数"]??"0").replace(/,/g,"")),
    viewsIncrease: Number((r["viewsincrease"]??r["週間増加数"]??"0").replace(/,/g,"")),
    note:     (r["note"]     ??r["備考"]         ??"").trim(),
  };
}

// ===================================================
// ★ 自動ランク計算
//   全週のrawデータを走査して、各週の順位・前週順位・isNew を付与する
// ===================================================
function computeAllRanks() {
  State.computed.clear();
  const periods = State.periods;

  // 前週のタイトルキー→順位 マップ
  let prevRankMap = new Map(); // titleKey → rank

  for (const p of periods) {
    const key = p.key;
    // この週の生データを viewsIncrease 降順でソート
    const rows = State.rawRanking
      .filter(r => r.year===p.y && r.month===String(p.m) && r.week===String(p.w))
      .sort((a,b) => b.viewsIncrease - a.viewsIncrease);

    const entries = rows.map((r, i) => {
      const rank     = i + 1;
      const titleKey = songKey(r);
      const prevRank = prevRankMap.has(titleKey) ? prevRankMap.get(titleKey) : null;
      const isNew    = !prevRankMap.has(titleKey);
      return { ...r, rank, previousRank: prevRank, isNew };
    });

    State.computed.set(key, entries);

    // 次週用に現在の順位マップを更新
    prevRankMap = new Map(entries.map(e => [songKey(e), e.rank]));
  }
}

// 曲の同一性を判断するキー（title + artist の正規化）
function songKey(e) {
  return (e.title + '|' + e.artist).toLowerCase().trim();
}

// ===================================================
// 初期化
// ===================================================
async function fetchCSV(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV取得失敗: ${res.status}`);
  return res.text();
}

async function init() {
  showLoading();
  try {
    const [rankText, untrkText, reqText] = await Promise.all([
      fetchCSV(CONFIG.SHEET_URLS.ranking),
      fetchCSV(CONFIG.SHEET_URLS.untracked),
      fetchCSV(CONFIG.SHEET_URLS.requests),
    ]);
    State.rawRanking   = csvToObjects(rankText).map(parseRankingRow).filter(Boolean);
    State.allUntracked = csvToObjects(untrkText).map(parseUntrackedRow).filter(r=>r.year&&r.title);
    State.allRequests  = csvToObjects(reqText).map(parseRequestRow).filter(r=>r.year&&r.title);
  } catch(err) {
    showError('スプレッドシートの読み込みに失敗しました', err.message);
    return;
  }

  if (!State.rawRanking.length) {
    showError('データがありません', 'スプレッドシートにデータを入力してください。');
    return;
  }

  // ★ ランク自動計算
  computeAllRanks();

  const last = State.periods[State.periods.length - 1];
  State.year  = last.y;
  State.month = String(last.m);
  State.week  = String(last.w);

  buildSelectors();
  render();
  bindEvents();
}

// ===================================================
// セレクタ
// ===================================================
function buildSelectors() {
  buildYearSelect(); buildMonthSelect(); buildWeekSelect();
}
function buildYearSelect() {
  const sel = document.getElementById('sel-year');
  sel.innerHTML = '';
  State.years.forEach(y => sel.appendChild(new Option(`${y}年`, y, y==State.year, y==State.year)));
}
function buildMonthSelect() {
  const sel = document.getElementById('sel-month');
  sel.innerHTML = '';
  State.months.forEach(m => { const ms=String(m); sel.appendChild(new Option(`${m}月`,ms,ms===State.month,ms===State.month)); });
}
function buildWeekSelect() {
  const sel = document.getElementById('sel-week');
  sel.innerHTML = '';
  State.weeks.forEach(w => { const ws=String(w); sel.appendChild(new Option(`第${w}週`,ws,ws===State.week,ws===State.week)); });
}

// ===================================================
// イベント
// ===================================================
function bindEvents() {
  document.getElementById('sel-year').addEventListener('change', e => {
    State.year = e.target.value;
    State.month = String(State.months[State.months.length-1]);
    buildMonthSelect();
    State.week = String(State.weeks[State.weeks.length-1]);
    buildWeekSelect();
    render();
  });
  document.getElementById('sel-month').addEventListener('change', e => {
    State.month = e.target.value;
    State.week = String(State.weeks[State.weeks.length-1]);
    buildWeekSelect();
    render();
  });
  document.getElementById('sel-week').addEventListener('change', e => {
    State.week = e.target.value;
    render();
  });
  document.getElementById('btn-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigate(+1));
  document.getElementById('btn-toggle-views').addEventListener('click', () => {
    State.showTotalViews = !State.showTotalViews;
    document.getElementById('btn-toggle-views').classList.toggle('active', State.showTotalViews);
    document.querySelectorAll('.views-total').forEach(el => el.classList.toggle('visible', State.showTotalViews));
  });
  document.getElementById('btn-toggle-detail').addEventListener('click', () => {
    State.showDetailViews = !State.showDetailViews;
    document.getElementById('btn-toggle-detail').classList.toggle('active', State.showDetailViews);
    render();
  });
  document.getElementById('btn-toggle-chart').addEventListener('click', () => {
    State.chartVisible = !State.chartVisible;
    State.chartSongFilter = null;
    document.getElementById('btn-toggle-chart').classList.toggle('active', State.chartVisible);
    renderChart();
  });
}

function navigate(dir) {
  const ps = State.periods;
  const cur = ps.findIndex(p => p.y==State.year && p.m==Number(State.month) && p.w==Number(State.week));
  if (cur===-1) return;
  const next = ps[cur+dir];
  if (!next) return;
  State.year=next.y; State.month=String(next.m); State.week=String(next.w);
  document.getElementById('sel-year').value=State.year;
  buildMonthSelect(); document.getElementById('sel-month').value=State.month;
  buildWeekSelect();  document.getElementById('sel-week').value=State.week;
  render();
}

function updateNavButtons() {
  const ps = State.periods;
  const cur = ps.findIndex(p => p.y==State.year && p.m==Number(State.month) && p.w==Number(State.week));
  document.getElementById('btn-prev').disabled = cur<=0;
  document.getElementById('btn-next').disabled = cur>=ps.length-1;
}

// ===================================================
// ランキング描画
// ===================================================
function render() {
  updateNavButtons();
  document.getElementById('period-label').textContent =
    `${State.year}年 ${Number(State.month)}月 第${Number(State.week)}週`;

  const entries   = State.currentRanking;
  const untracked = State.currentUntracked;
  const requests  = State.currentRequests;
  const list      = document.getElementById('ranking-list');

  if (!entries.length && !untracked.length && !requests.length) {
    list.innerHTML = `<div class="state-msg"><h2>データがありません</h2><p>この期間のデータはまだ登録されていません。</p></div>`;
    renderChart();
    return;
  }

  const million = entries.filter(e => e.viewsIncrease >= CONFIG.THRESHOLDS.MILLION);
  const half    = entries.filter(e => e.viewsIncrease >= CONFIG.THRESHOLDS.HALF   && e.viewsIncrease < CONFIG.THRESHOLDS.MILLION);
  const third   = entries.filter(e => e.viewsIncrease >= CONFIG.THRESHOLDS.THIRD  && e.viewsIncrease < CONFIG.THRESHOLDS.HALF);
  const rest    = entries.filter(e => e.viewsIncrease <  CONFIG.THRESHOLDS.THIRD);

  // 「30万以上」セクションを表示するか判定:
  // ランキング曲（依頼枠・未統計化を除く）の最低増加数が50万以上なら非表示
  const minIncrease = entries.length ? Math.min(...entries.map(e => e.viewsIncrease)) : 0;
  const showThird   = third.length > 0 && minIncrease < CONFIG.THRESHOLDS.HALF;

  // セクションが何か1つでもある場合にrest用ヘッダーを出すかの判定フラグ
  const hasUpperSections = million.length || half.length || showThird || untracked.length || requests.length;

  let idx=0, html='';

  // 順序: 100万 → 50万 → 30万（条件付き）→ 未統計化 → 依頼枠 → 通常
  if (million.length) {
    html += sectionHeader('million','週間100万回以上','');
    html += million.map(e => buildEntryHTML(e, idx++)).join('');
  }
  if (half.length) {
    html += sectionHeader('half','週間50万回以上','');
    html += half.map(e => buildEntryHTML(e, idx++)).join('');
  }
  if (showThird) {
    html += sectionHeader('third','週間30万回以上','');
    html += third.map(e => buildEntryHTML(e, idx++)).join('');
  }
  if (untracked.length) {
    html += sectionHeader('untracked','未統計化曲','');
    html += untracked.map(e => buildUntrackedHTML(e, idx++)).join('');
  }
  if (requests.length) {
    html += sectionHeader('requests','依頼枠','視聴者からのリクエスト');
    html += requests.map(e => buildRequestHTML(e, idx++)).join('');
  }
  if (rest.length) {
    if (hasUpperSections) html += sectionHeader('rest','ランキング','');
    html += rest.map(e => buildEntryHTML(e, idx++)).join('');
  }

  list.innerHTML = html;
  if (State.showTotalViews)
    document.querySelectorAll('.views-total').forEach(el=>el.classList.add('visible'));

  // 曲クリックでチャートをフィルタ
  document.querySelectorAll('.ranking-item[data-song-key]').forEach(el => {
    el.addEventListener('click', ev => {
      if (!State.chartVisible) return; // チャート非表示中はYouTubeへ飛ぶ通常動作
      ev.preventDefault();
      const k = el.dataset.songKey;
      State.chartSongFilter = State.chartSongFilter===k ? null : k;
      renderChart();
    });
  });

  renderChart();
}

function sectionHeader(type, label, sub) {
  const icons={untracked:'◈',million:'▶▶▶',half:'▶▶',third:'▶',requests:'✉',rest:'♪'};
  return `<div class="section-header section-${type}">
    <span class="section-icon">${icons[type]}</span>
    <span class="section-label">${esc(label)}</span>
    ${sub?`<span class="section-sub">${esc(sub)}</span>`:''}
  </div>`;
}

function buildEntryHTML(e, i) {
  const rc = e.rank<=3?`rank-${e.rank}`:'rank-other';
  let ch;
  if (e.isNew) ch=`<span class="rank-change new">NEW</span>`;
  else if (e.previousRank===null) ch=`<span class="rank-change same">—</span>`;
  else {
    const d=e.previousRank-e.rank;
    if (d>0) ch=`<span class="rank-change up">▲${d}</span>`;
    else if(d<0) ch=`<span class="rank-change down">▼${Math.abs(d)}</span>`;
    else ch=`<span class="rank-change same">→</span>`;
  }
  const yt=`https://www.youtube.com/watch?v=${e.videoId}`;
  const sk=songKey(e);
  const active=State.chartVisible&&State.chartSongFilter===sk?' chart-selected':'';
  return `
  <a class="ranking-item${active}" href="${yt}" target="_blank" rel="noopener noreferrer"
     data-song-key="${esc(sk)}" style="animation-delay:${i*0.03}s"
     aria-label="${e.rank}位: ${esc(e.title)}">
    <div class="rank-block">
      <span class="rank-num ${rc}">${e.rank}</span>${ch}
    </div>
    <div class="song-info">
      <span class="song-title">${esc(e.title)}</span>
      <span class="song-artist">${esc(e.artist)}</span>
    </div>
    <div class="views-block">
      <span class="views-total${State.showTotalViews?' visible':''}">${fvAuto(e.views)}</span>
      <span class="views-increase">+${fvAuto(e.viewsIncrease)}</span>
    </div>
  </a>`;
}

function buildUntrackedHTML(e, i) {
  const yt=e.videoId?`https://www.youtube.com/watch?v=${e.videoId}`:'#';
  return `
  <a class="ranking-item ranking-item--untracked" href="${yt}" target="_blank" rel="noopener noreferrer"
     style="animation-delay:${i*0.03}s">
    <div class="rank-block"><span class="untracked-icon">◈</span></div>
    <div class="song-info">
      <span class="song-title">${esc(e.title)}</span>
      <span class="song-artist">${esc(e.artist)}</span>
    </div>
    <div class="views-block">${e.note?`<span class="item-note">${esc(e.note)}</span>`:'<span class="views-increase">—</span>'}</div>
  </a>`;
}

function buildRequestHTML(e, i) {
  const yt=e.videoId?`https://www.youtube.com/watch?v=${e.videoId}`:"#";
  return `
  <a class="ranking-item ranking-item--request" href="${yt}" target="_blank" rel="noopener noreferrer"
     style="animation-delay:${i*0.03}s">
    <div class="rank-block"><span class="request-icon">✉</span></div>
    <div class="song-info">
      <span class="song-title">${esc(e.title)}</span>
      <span class="song-artist">${esc(e.artist)}</span>
    </div>
    <div class="views-block">
      <span class="views-total${State.showTotalViews?" visible":""}">${e.views?fvAuto(e.views):"—"}</span>
      <span class="views-increase">${e.viewsIncrease?"+"+fvAuto(e.viewsIncrease):"—"}</span>
    </div>
  </a>`;
}

// ===================================================
// ★ チャート描画（Canvas / 純粋JS、外部ライブラリ不要）
// ===================================================
function renderChart() {
  const wrap = document.getElementById('chart-wrap');
  if (!State.chartVisible) { wrap.style.display='none'; return; }
  wrap.style.display='block';

  const canvas = document.getElementById('rank-chart');
  const ctx    = canvas.getContext('2d');

  // 表示する週を現在週から遡って最大 CHART_WEEKS 件
  const allPeriods = State.periods;
  const curIdx = allPeriods.findIndex(p =>
    p.y==State.year && p.m==Number(State.month) && p.w==Number(State.week));
  const sliceStart = Math.max(0, curIdx - CONFIG.CHART_WEEKS + 1);
  const chartPeriods = allPeriods.slice(sliceStart, curIdx+1);

  if (chartPeriods.length < 2) {
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = getComputedStyle(document.documentElement)
      .getPropertyValue('--text-muted').trim() || '#6a6088';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('チャートには2週分以上のデータが必要です', canvas.width/2, canvas.height/2);
    return;
  }

  // 最新週の上位 N 曲 OR 指定曲
  const latestEntries = State.computed.get(allPeriods[curIdx].key) ?? [];
  let trackedKeys;
  if (State.chartSongFilter) {
    trackedKeys = [State.chartSongFilter];
  } else {
    trackedKeys = latestEntries.slice(0, CONFIG.CHART_TOP_N).map(e => songKey(e));
  }

  // 各曲の各週の順位を収集（その週にランク外 = null）
  const songData = new Map(); // titleKey → {label, data:[rank|null, ...]}
  for (const tk of trackedKeys) {
    // ラベル名を最新週から取得
    const found = latestEntries.find(e => songKey(e)===tk);
    const label = found ? found.title : tk;
    songData.set(tk, { label, data: chartPeriods.map(() => null) });
  }
  chartPeriods.forEach((p, pi) => {
    const entries = State.computed.get(p.key) ?? [];
    for (const e of entries) {
      const k = songKey(e);
      if (songData.has(k)) songData.get(k).data[pi] = e.rank;
    }
  });

  // ===== 描画 =====
  const DPR  = window.devicePixelRatio || 1;
  const W    = canvas.clientWidth;
  const H    = canvas.clientHeight;
  canvas.width  = W * DPR;
  canvas.height = H * DPR;
  ctx.scale(DPR, DPR);

  const PAD = { top:20, right:20, bottom:48, left:44 };
  const cw  = W - PAD.left - PAD.right;
  const ch  = H - PAD.top  - PAD.bottom;

  // 背景
  ctx.clearRect(0,0,W,H);

  // Y軸: 順位（1が上）
  // 全データの最大順位を求める
  let maxRank = 1;
  for (const d of songData.values())
    d.data.forEach(v => { if(v!==null && v>maxRank) maxRank=v; });
  maxRank = Math.max(maxRank, 10);

  // グリッド線
  const gridColor  = 'rgba(157,126,232,0.12)';
  const gridSteps  = [1,5,10,20,50].filter(s=>s<=maxRank);
  ctx.strokeStyle = gridColor;
  ctx.lineWidth   = 0.5;
  for (const rank of [1,5,10,20,30,50,100].filter(r=>r<=maxRank+2)) {
    const y = PAD.top + ch * (rank-1) / maxRank;
    ctx.beginPath(); ctx.moveTo(PAD.left,y); ctx.lineTo(PAD.left+cw,y); ctx.stroke();
    ctx.fillStyle='rgba(157,126,232,0.5)';
    ctx.font=`10px var(--font-num,'Courier New')`;
    ctx.textAlign='right';
    ctx.fillText(rank, PAD.left-6, y+3);
  }

  // X軸ラベル（週）
  ctx.fillStyle='rgba(160,150,200,0.7)';
  ctx.font='11px sans-serif';
  ctx.textAlign='center';
  chartPeriods.forEach((p,i) => {
    const x = PAD.left + cw * i / (chartPeriods.length-1);
    const label = `${p.m}/${p.w}`;
    ctx.fillText(label, x, H-PAD.bottom+16);
  });

  // 軸タイトル
  ctx.save();
  ctx.translate(10, PAD.top+ch/2);
  ctx.rotate(-Math.PI/2);
  ctx.fillStyle='rgba(160,150,200,0.5)';
  ctx.font='10px sans-serif';
  ctx.textAlign='center';
  ctx.fillText('順位', 0, 0);
  ctx.restore();

  // 折れ線カラーパレット
  const COLORS = [
    '#9d7ee8','#e87eb8','#4ecdc4','#f5c842','#ff7c5c',
    '#7eb8e8','#b8e87e','#e8c47e','#c4e87e','#7ee8c4',
  ];

  // 折れ線を描画
  const songs = [...songData.values()];
  songs.forEach((s, si) => {
    const color = COLORS[si % COLORS.length];
    const pts = s.data.map((rank, i) => {
      if (rank===null) return null;
      return {
        x: PAD.left + cw * i / Math.max(chartPeriods.length-1, 1),
        y: PAD.top  + ch * (rank-1) / maxRank,
      };
    });

    // 線
    ctx.strokeStyle = color;
    ctx.lineWidth   = State.chartSongFilter ? 2.5 : 1.8;
    ctx.lineJoin    = 'round';
    ctx.setLineDash([]);
    let started=false;
    ctx.beginPath();
    pts.forEach(pt => {
      if (!pt) { started=false; return; }
      if (!started) { ctx.moveTo(pt.x,pt.y); started=true; }
      else ctx.lineTo(pt.x,pt.y);
    });
    ctx.stroke();

    // 点
    pts.forEach((pt,pi) => {
      if (!pt) return;
      ctx.beginPath();
      ctx.arc(pt.x,pt.y,3.5,0,Math.PI*2);
      ctx.fillStyle=color;
      ctx.fill();
      ctx.strokeStyle='rgba(13,10,26,0.6)';
      ctx.lineWidth=1;
      ctx.stroke();
    });

    // 末端ラベル
    const last = [...pts].reverse().find(p=>p!==null);
    if (last) {
      ctx.fillStyle=color;
      ctx.font=`bold 11px sans-serif`;
      ctx.textAlign='left';
      const short = s.label.length>12 ? s.label.slice(0,11)+'…' : s.label;
      ctx.fillText(short, last.x+6, last.y+4);
    }
  });

  // 凡例（チャート外 = 複数曲時のみ）
  if (!State.chartSongFilter && songs.length > 1) {
    renderChartLegend(songs, COLORS);
  } else if (State.chartSongFilter) {
    renderChartLegend(songs, COLORS);
  }
}

function renderChartLegend(songs, colors) {
  const leg = document.getElementById('chart-legend');
  leg.innerHTML = songs.map((s,i) =>
    `<span class="legend-item" style="--c:${colors[i%colors.length]}">
      <span class="legend-dot"></span>${esc(s.label.length>18?s.label.slice(0,17)+'…':s.label)}
    </span>`
  ).join('');
}

// ===================================================
// ローディング・エラー
// ===================================================
function showLoading() {
  document.getElementById('ranking-list').innerHTML =
    Array.from({length:8},()=>`<div class="loading-shimmer"></div>`).join('');
}
function showError(msg,detail='') {
  document.getElementById('ranking-list').innerHTML =
    `<div class="state-msg"><h2>${esc(msg)}</h2><p>${esc(detail)}</p></div>`;
}

// ===================================================
// ユーティリティ
// ===================================================
// 通常表示: 億・万単位（1億以上は「1億2345.7万」形式）
function fv(n) {
  n = Number(n);
  if (n >= 100_000_000) {
    const okuInt = Math.floor(n / 100_000_000);          // 億の整数部
    const man    = (n % 100_000_000) / 10_000;           // 残りを万単位に
    const manStr = man >= 0.1 ? (man % 1 === 0 ? man.toFixed(0) : man.toFixed(1)) + '万' : '';
    return okuInt + '億' + manStr;
  }
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '万';
  return n.toLocaleString('ja-JP');
}
// 詳細表示: カンマ区切りの正確な値
function fvDetail(n) {
  return Number(n).toLocaleString('ja-JP');
}
// 状態に応じて切り替え
function fvAuto(n) {
  return State.showDetailViews ? fvDetail(n) : fv(n);
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('DOMContentLoaded', init);
