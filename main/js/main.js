/**
 * Vocaloid Total Ranking — main.js
 *
 * ■ スプレッドシートに入力する列（総合ランキング用シート）
 *   year, month, week, title, artist, videoId, views, viewsIncrease
 *   ※ 総再生数（views）の多い順に並べ、rank / previousRank / isNew は全てここで計算
 *   ※ viewsIncrease は「増加回数」ボタンで表示する参考値（空欄でも可）
 *
 * ■ 設定手順
 *   1. 総合ランキング用のスプレッドシートを「リンクを知っている全員が閲覧可」にする
 *   2. 下の SHEET_ID にスプレッドシートのID、GID にシートのgidを入れる
 */

const CONFIG = {
  SHEET_ID: '1pVrvQz4zaktp5PANILwiTBLfeyNDmBq7rnutJJ4CuFU', // ★ 総合ランキング用スプレッドシートのIDに置き換える
  GID:      '0',                         // ★ 使うシートのgid
  PAGE_SIZE: 50,                         // 1ページあたりの最大曲数
  MAX_PAGES: 10,                         // ページボタンの最大数（= 最大 500 曲まで表示）
};

function sheetUrl() {
  return `https://docs.google.com/spreadsheets/d/${CONFIG.SHEET_ID}/export?format=csv&gid=${CONFIG.GID}`;
}

// ===== 状態 =====
const State = {
  rawRanking: [],
  computed:   new Map(), // periodKey → entry[]（総再生数順）

  year:  null,
  month: null,
  week:  null,
  page:  1,
  showIncrease:    false,
  showDetailViews: false,

  get periods() {
    const set = new Set(State.rawRanking.map(r => `${r.year}|${r.month}|${r.week}`));
    return [...set]
      .map(k => { const [y,m,w] = k.split('|'); return {y, m:Number(m), w:Number(w), key:k}; })
      .sort((a,b) => a.y!==b.y ? a.y.localeCompare(b.y) : a.m!==b.m ? a.m-b.m : a.w-b.w);
  },
  get years()  { return [...new Set(State.periods.map(p => p.y))]; },
  get months() { return [...new Set(State.periods.filter(p => p.y==State.year).map(p => p.m))]; },
  get weeks()  {
    return [...new Set(
      State.periods.filter(p => p.y==State.year && p.m==Number(State.month)).map(p => p.w)
    )];
  },
  get currentKey()     { return `${State.year}|${State.month}|${State.week}`; },
  get currentRanking() { return State.computed.get(State.currentKey) ?? []; },
};

// ===== CSV パース =====
function parseCSV(text) {
  const rows = [];
  let col='', row=[], inQ=false;
  for (let i=0; i<text.length; i++) {
    const c=text[i], nx=text[i+1];
    if (inQ) {
      if (c==='"'&&nx==='"'){col+='"';i++;}
      else if(c==='"'){inQ=false;}
      else{col+=c;}
    } else {
      if(c==='"'){inQ=true;}
      else if(c===','){row.push(col.trim());col='';}
      else if(c==='\n'||c==='\r'){
        row.push(col.trim());col='';
        if(row.some(x=>x))rows.push(row);
        row=[];
        if(c==='\r'&&nx==='\n')i++;
      } else{col+=c;}
    }
  }
  if(col||row.length){row.push(col.trim());if(row.some(x=>x))rows.push(row);}
  return rows;
}

function csvToObjects(text) {
  const rows=parseCSV(text);
  if(rows.length<2)return[];
  const headers=rows[0].map(h=>h.toLowerCase().replace(/\s/g,''));
  return rows.slice(1).map(row=>{
    const obj={};
    headers.forEach((h,i)=>obj[h]=(row[i]??'').trim());
    return obj;
  });
}

// ===== 生データ → 構造体 =====
function toNum(v){ return Number(String(v??'0').replace(/,/g,'')) || 0; }

function parseRankingRow(r) {
  const year =String(r['year'] ??r['年'] ??'').trim();
  const month=String(r['month']??r['月'] ??'').trim();
  const week =String(r['week'] ??r['週'] ??'').trim();
  const title=(r['title']??r['曲名']??'').trim();
  if(!year||!month||!week||!title)return null;
  return {
    year,month,week,title,
    artist: (r['artist']??r['アーティスト']??'').trim(),
    videoId:(r['videoid']??r['動画id']     ??'').trim(),
    views:        toNum(r['views']        ??r['累計再生数']),
    viewsIncrease:toNum(r['viewsincrease']??r['週間増加数']),
  };
}

// ===== 曲キー =====
function songKey(e) {
  return (e.title+'|'+e.artist).toLowerCase().trim();
}

// ===== 自動ランク計算（総再生数の多い順） =====
function computeAllRanks() {
  State.computed.clear();
  let prevRankMap=null; // 最初の週は「NEW」扱いにしない
  for (const p of State.periods) {
    const rows=State.rawRanking
      .filter(r=>r.year===p.y&&r.month===String(p.m)&&r.week===String(p.w))
      .sort((a,b)=>b.views-a.views || b.viewsIncrease-a.viewsIncrease);
    const entries=rows.map((r,i)=>{
      const tk=songKey(r);
      const has=prevRankMap?.has(tk);
      return{
        ...r,
        rank:i+1,
        previousRank:has?prevRankMap.get(tk):null,
        isNew:prevRankMap!==null&&!has,
      };
    });
    State.computed.set(p.key,entries);
    prevRankMap=new Map(entries.map(e=>[songKey(e),e.rank]));
  }
}

// ===== サムネイルHTML =====
function thumbHTML(videoId) {
  if(videoId){
    return `<div class="thumb-block">
      <img class="thumb-img" src="https://img.youtube.com/vi/${videoId}/mqdefault.jpg"
           alt="" loading="lazy" onerror="this.parentElement.classList.add('thumb-error')">
    </div>`;
  }
  return `<div class="thumb-block thumb-empty"></div>`;
}

// ===== データ取得 =====
async function fetchCSV(url) {
  const res=await fetch(url);
  if(!res.ok)throw new Error(`CSV取得失敗: ${res.status}`);
  return res.text();
}

// ===== 初期化 =====
async function init() {
  showLoading();
  if(CONFIG.SHEET_ID.startsWith('YOUR_')){
    showError('スプレッドシートが未設定です','main/js/main.js の CONFIG.SHEET_ID に\n総合ランキング用スプレッドシートのIDを入力してください。');
    return;
  }
  try {
    const text=await fetchCSV(sheetUrl());
    State.rawRanking=csvToObjects(text).map(parseRankingRow).filter(Boolean);
  } catch(err) {
    showError('スプレッドシートの読み込みに失敗しました',err.message);
    return;
  }
  if(!State.rawRanking.length){
    showError('データがありません','スプレッドシートにデータを入力してください。');
    return;
  }
  computeAllRanks();

  const last=State.periods[State.periods.length-1];
  State.year=last.y; State.month=String(last.m); State.week=String(last.w);
  buildSelectors();
  render();
  bindEvents();
}

// ===== セレクタ =====
function buildSelectors(){buildYearSelect();buildMonthSelect();buildWeekSelect();}
function buildYearSelect(){
  const sel=document.getElementById('sel-year');sel.innerHTML='';
  State.years.forEach(y=>sel.appendChild(new Option(`${y}年`,y,y==State.year,y==State.year)));
}
function buildMonthSelect(){
  const sel=document.getElementById('sel-month');sel.innerHTML='';
  State.months.forEach(m=>{const ms=String(m);sel.appendChild(new Option(`${m}月`,ms,ms===State.month,ms===State.month));});
}
function buildWeekSelect(){
  const sel=document.getElementById('sel-week');sel.innerHTML='';
  State.weeks.forEach(w=>{const ws=String(w);sel.appendChild(new Option(`第${w}週`,ws,ws===State.week,ws===State.week));});
}

// ===== イベント =====
function bindEvents(){
  document.getElementById('sel-year').addEventListener('change',e=>{
    State.year=e.target.value;
    State.month=String(State.months[State.months.length-1]);
    buildMonthSelect();
    State.week=String(State.weeks[State.weeks.length-1]);
    buildWeekSelect();
    State.page=1;
    render();
  });
  document.getElementById('sel-month').addEventListener('change',e=>{
    State.month=e.target.value;
    State.week=String(State.weeks[State.weeks.length-1]);
    buildWeekSelect();
    State.page=1;
    render();
  });
  document.getElementById('sel-week').addEventListener('change',e=>{
    State.week=e.target.value;
    State.page=1;
    render();
  });
  document.getElementById('btn-prev').addEventListener('click',()=>navigate(-1));
  document.getElementById('btn-next').addEventListener('click',()=>navigate(+1));

  // 増加回数の表示切替（再描画不要、bodyのクラスだけ切り替える）
  document.getElementById('btn-toggle-increase').addEventListener('click',()=>{
    State.showIncrease=!State.showIncrease;
    document.getElementById('btn-toggle-increase').classList.toggle('active',State.showIncrease);
    document.body.classList.toggle('show-increase',State.showIncrease);
  });
  // 詳細回数（万表記 ⇔ カンマ区切りの実数）
  document.getElementById('btn-toggle-detail').addEventListener('click',()=>{
    State.showDetailViews=!State.showDetailViews;
    document.getElementById('btn-toggle-detail').classList.toggle('active',State.showDetailViews);
    render();
  });

  // ページボタン（上下どちらも同じ処理）
  ['pagination-top','pagination-bottom'].forEach(id=>{
    document.getElementById(id).addEventListener('click',e=>{
      const btn=e.target.closest('.page-btn');
      if(!btn||btn.disabled||btn.classList.contains('active'))return;
      State.page=Number(btn.dataset.page);
      render();
      document.querySelector('.controls').scrollIntoView({behavior:'smooth',block:'start'});
    });
  });
}

function navigate(dir){
  const ps=State.periods;
  const cur=ps.findIndex(p=>p.y==State.year&&p.m==Number(State.month)&&p.w==Number(State.week));
  if(cur===-1)return;
  const next=ps[cur+dir];
  if(!next)return;
  State.year=next.y;State.month=String(next.m);State.week=String(next.w);
  State.page=1;
  document.getElementById('sel-year').value=State.year;
  buildMonthSelect();document.getElementById('sel-month').value=State.month;
  buildWeekSelect(); document.getElementById('sel-week').value=State.week;
  render();
}

function updateNavButtons(){
  const ps=State.periods;
  const cur=ps.findIndex(p=>p.y==State.year&&p.m==Number(State.month)&&p.w==Number(State.week));
  document.getElementById('btn-prev').disabled=cur<=0;
  document.getElementById('btn-next').disabled=cur>=ps.length-1;
}

// ===== 描画 =====
function render(){
  updateNavButtons();
  document.getElementById('period-label').textContent=
    `${State.year}年 ${Number(State.month)}月 第${Number(State.week)}週時点`;

  const entries=State.currentRanking;
  const list=document.getElementById('ranking-list');

  if(!entries.length){
    list.innerHTML=`<div class="state-msg"><h2>データがありません</h2><p>この期間のデータはまだ登録されていません。</p></div>`;
    renderPagination(0);
    return;
  }

  // 表示できる最大曲数（ページ数の上限 × 1ページの曲数）
  const visible=entries.slice(0,CONFIG.PAGE_SIZE*CONFIG.MAX_PAGES);
  renderPagination(visible.length); // ここで State.page が範囲内に補正される

  const start=(State.page-1)*CONFIG.PAGE_SIZE;
  const pageEntries=visible.slice(start,start+CONFIG.PAGE_SIZE);
  list.innerHTML=pageEntries.map((e,i)=>buildEntryHTML(e,i)).join('');
}

// ===== ページボタン =====
function renderPagination(total){
  const pages=Math.min(Math.ceil(total/CONFIG.PAGE_SIZE),CONFIG.MAX_PAGES);
  State.page=Math.min(Math.max(State.page,1),Math.max(pages,1));

  let html='';
  if(pages>1){
    html+=`<button class="page-btn" data-page="${State.page-1}" aria-label="前のページ"${State.page===1?' disabled':''}>◀</button>`;
    for(let p=1;p<=pages;p++){
      const cur=p===State.page;
      html+=`<button class="page-btn${cur?' active':''}" data-page="${p}" aria-label="${p}ページ目"${cur?' aria-current="page"':''}>${p}</button>`;
    }
    html+=`<button class="page-btn" data-page="${State.page+1}" aria-label="次のページ"${State.page===pages?' disabled':''}>▶</button>`;
  }
  document.getElementById('pagination-top').innerHTML=html;
  document.getElementById('pagination-bottom').innerHTML=html;
}

// ===== ランキングアイテム =====
function buildEntryHTML(e,i){
  const rc=e.rank<=3?`rank-${e.rank}`:'rank-other';
  let ch;
  if(e.isNew)ch=`<span class="rank-change new">NEW</span>`;
  else if(e.previousRank===null)ch=`<span class="rank-change same">—</span>`;
  else{
    const d=e.previousRank-e.rank;
    if(d>0)ch=`<span class="rank-change up">▲${d}</span>`;
    else if(d<0)ch=`<span class="rank-change down">▼${Math.abs(d)}</span>`;
    else ch=`<span class="rank-change same">→</span>`;
  }
  const yt=e.videoId?`https://www.youtube.com/watch?v=${e.videoId}`:'#';
  return `
  <a class="ranking-item" href="${yt}" target="_blank" rel="noopener noreferrer"
     style="animation-delay:${i*0.03}s" aria-label="${e.rank}位: ${esc(e.title)}">
    <div class="rank-block">
      <span class="rank-num ${rc}">${e.rank}</span>${ch}
    </div>
    ${thumbHTML(e.videoId)}
    <div class="song-info">
      <span class="song-title">${esc(e.title)}</span>
      <span class="song-artist">${esc(e.artist)}</span>
    </div>
    <div class="views-block">
      <span class="views-total">${e.views?fvAuto(e.views):'—'}</span>
      <span class="views-increase">${e.viewsIncrease?'+'+fvAuto(e.viewsIncrease):'—'}</span>
    </div>
  </a>`;
}

// ===== ローディング・エラー =====
function showLoading(){
  document.getElementById('ranking-list').innerHTML=
    Array.from({length:8},()=>`<div class="loading-shimmer"></div>`).join('');
}
function showError(msg,detail=''){
  document.getElementById('period-label').textContent='';
  document.getElementById('ranking-list').innerHTML=
    `<div class="state-msg"><h2>${esc(msg)}</h2><p>${esc(detail)}</p></div>`;
}

// ===== ユーティリティ =====
function fv(n){
  n=Number(n);
  if(n>=100_000_000){
    const okuInt=Math.floor(n/100_000_000);
    const man=(n%100_000_000)/10_000;
    const manStr=man>=0.1?(man%1===0?man.toFixed(0):man.toFixed(1))+'万':'';
    return okuInt+'億'+manStr;
  }
  if(n>=10_000)return(n/10_000).toFixed(1)+'万';
  return n.toLocaleString('ja-JP');
}
function fvDetail(n){return Number(n).toLocaleString('ja-JP');}
function fvAuto(n){return State.showDetailViews?fvDetail(n):fv(n);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

document.addEventListener('DOMContentLoaded',init);
