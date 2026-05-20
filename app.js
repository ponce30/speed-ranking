const REPO_OWNER = 'ponce30';
const REPO_NAME = 'speed-ranking';
const DATA_DIR = 'data';
const PAT_KEY = 'speed-ranking:pat';

// 入力は「Stat Search Results」の生データ(1行=1プレー)をテキスト貼り付け想定。
// 各プレーをそのままランキング1行として扱う (同一選手が複数回ランクインしてOK)。
// 列の順番自由 / 余分な列を含んでもOK — headers.indexOf(src) で必要な列だけ動的に抽出する。
// Tableauから貼り付けた時に複数行に分かれるセル (Game の "2026-04-05\nロ\n@\nソ" など) も
// joinMultilineCells で自動結合する。制約: 複数行セルは「末尾の列」に存在することを想定。
const COLUMN_MAP = [
  { dst: 'Rk',                src: null,                  type: 'num', agg: 'rank' },
  { dst: '日付',               src: 'Game',                type: 'str' },     // Game値から YYYY-MM-DD を抽出
  { dst: '対戦',               src: 'Game',                type: 'str' },     // Game値から日付以外の対戦表記を抽出
  { dst: 'Player',            src: 'Player',              type: 'str' },
  { dst: 'Team',              src: 'Team',                type: 'str' },     // 球団略号 (色付け用)
  { dst: 'H-1st (秒)',         src: 'H-1st (SEC)',         type: 'num', decimals: 2 },
  { dst: '1st-2nd 盗塁 (秒)',   src: '1st-2nd Steal (SEC)', type: 'num', decimals: 2 },  // 空欄OK
  { dst: 'SS (m/s)',          src: 'SS (M/S)',            type: 'num', decimals: 1 },
];

// 行ごと除外の閾値 (計測エラーや異常値の安全網)
const H1ST_MIN_VALID = 3.0;   // H-1st (SEC) < 3.0 は計測エラー (NPB打者で常識的に出ない値)
const SS_MAX_VALID = 11.0;    // SS (M/S) ≥ 11.0 は計測エラー (人間の限界超え)

// NPB12球団のチーム略号 → 表示色 (catcher と統一)
const TEAM_COLORS = {
  '巨': '#F97709',  // 巨人 オレンジ
  '神': '#FFE100',  // 阪神 タイガースイエロー
  'ソ': '#DAA520',  // ソフトバンク ゴールド
  '中': '#4A90D9',  // 中日 ライトブルー
  'デ': '#009DDC',  // DeNA シアン
  '西': '#2855B0',  // 西武 ブルー
  '日': '#6EC0EC',  // 日本ハム 薄青
  'ヤ': '#00C26F',  // ヤクルト グリーン
  '広': '#FF3344',  // 広島 カープレッド
  '楽': '#C8102E',  // 楽天 クリムゾン
  'ロ': '#B0B0B0',  // ロッテ シルバー
  'オ': '#B79764',  // オリックス 金茶
};

let currentRows = [];
let sortState = { col: 'H-1st (秒)', dir: 'asc' };

// タブ区切り(Tableauコピペ) / カンマ区切り(CSV) の両方に対応。
function detectDelim(text) {
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tabs = (line.match(/\t/g) || []).length;
    const commas = (line.match(/,/g) || []).length;
    return tabs > commas ? '\t' : ',';
  }
  return ',';
}

// Tableauからのコピペで「Game」など複数行に渡るセル値が改行で分割された場合に再統合する。
function joinMultilineCells(text) {
  if (detectDelim(text) !== '\t') return text;
  const lines = text.split(/\r?\n/);
  if (lines.length === 0) return text;
  const headerLine = lines[0];
  const expectedCols = headerLine.split('\t').length;
  if (expectedCols < 2) return text;

  const recordTabThreshold = Math.max(1, Math.floor(expectedCols / 2));

  const out = [headerLine];
  let current = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const tabCount = (line.match(/\t/g) || []).length;
    // 先頭タブで始まる行は「前レコードの残りセル」を意味する続き行 (新レコードとは扱わない)
    const startsWithTab = line.startsWith('\t');
    if (!startsWithTab && tabCount >= recordTabThreshold) {
      if (current !== null) out.push(current);
      current = line;
    } else if (current !== null) {
      const lineTabs = (line.match(/\t/g) || []).length;
      const trimmed = line.trim();
      if (lineTabs > 0) {
        // タブ含む続き行 → レコードの残りセル群として追加
        // (例: Game列が中間にあり、Game値の改行行の後に H-1st/Steal/SS の値が別行で来る)
        const cols = current.split('\t');
        if (cols.length < expectedCols) {
          // タブの重複を避けつつ連結
          const currentEndsTab = current.endsWith('\t');
          const lineStartsTab = line.startsWith('\t');
          if (currentEndsTab && lineStartsTab) {
            current = current + line.slice(1);          // 重複TABを1つに
          } else if (currentEndsTab || lineStartsTab) {
            current = current + line;                    // どちらかにTABあり
          } else {
            current = current + '\t' + line;             // どちらにもTABなし → 区切り追加
          }
        } else {
          cols[cols.length - 1] += ' ' + line;
          current = cols.join('\t');
        }
      } else {
        // タブ無し単独行 → 既存末尾セルに連結 (Game値の改行を再結合する目的)
        if (current.endsWith('\t')) {
          current = current + trimmed;
        } else {
          const cols = current.split('\t');
          cols[cols.length - 1] += ' ' + trimmed;
          current = cols.join('\t');
        }
      }
    }
  }
  if (current !== null) out.push(current);
  return out.join('\n');
}

function parseCSV(text) {
  const delim = detectDelim(text);
  const lines = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); lines.push(row); }
  return lines.filter(r => r.some(v => v !== ''));
}

function csvToRows(text) {
  text = joinMultilineCells(text);
  const lines = parseCSV(text);
  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());

  const idxs = {};
  for (const c of COLUMN_MAP) {
    idxs[c.dst] = c.src ? headers.indexOf(c.src) : -1;
  }
  // Game / 1st-2nd Steal / Team は任意 (元データに無くてもOK)
  const optionalSrc = new Set(['Game', '1st-2nd Steal (SEC)', 'Team']);
  const missing = COLUMN_MAP.filter(c => c.src && !optionalSrc.has(c.src) && idxs[c.dst] < 0).map(c => c.src);
  if (missing.length > 0) console.warn('未検出の列:', missing);

  const h1Dst = 'H-1st (秒)';
  const ssDst = 'SS (m/s)';
  const MOJIBAKE_RE = /[A-Za-z�]/;
  const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;

  // ヘッダ列数 < データ列数 (Rk列がヘッダになくデータ先頭にだけある等) は先頭を切り捨て
  const headerLen = headers.length;
  const align = (dataRow) => dataRow.length > headerLen ? dataRow.slice(dataRow.length - headerLen) : dataRow;

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const dataRow = align(lines[i]);
    const row = {};
    for (const c of COLUMN_MAP) {
      if (!c.src) continue;
      const idx = idxs[c.dst];
      const raw = idx >= 0 ? (dataRow[idx] ?? '').trim() : '';
      if (c.dst === '日付') {
        const m = raw.match(DATE_RE);
        row[c.dst] = m ? m[0] : '';
      } else if (c.dst === '対戦') {
        row[c.dst] = raw.replace(DATE_RE, '').trim();
      } else {
        row[c.dst] = raw;
      }
    }
    // 行ごと除外:
    // - Player名にラテン文字/U+FFFD (文字化け)
    // - H-1st (秒) と SS (m/s) は数値必須 (このランキングの基幹指標)
    // - 1st-2nd 盗塁 (秒) は欠損OK (盗塁試行が無い打席もあるため)
    // - H-1st < 3.0 は計測エラー (異常な高速値)
    // - SS >= 11.0 は計測エラー
    if (MOJIBAKE_RE.test(row['Player'] || '')) continue;
    const h1 = parseFloat(row[h1Dst]);
    const ss = parseFloat(row[ssDst]);
    if (isNaN(h1) || isNaN(ss)) continue;
    if (h1 < H1ST_MIN_VALID) continue;
    if (ss >= SS_MAX_VALID) continue;
    rows.push(row);
  }

  // H-1st (秒) 昇順で Rk を1始まりで付与
  const ordered = [...rows].sort((a, b) => parseFloat(a[h1Dst]) - parseFloat(b[h1Dst]));
  ordered.forEach((r, i) => { r['Rk'] = String(i + 1); });

  return rows;
}

function sortRows() {
  if (!sortState.col) return;
  const colDef = COLUMN_MAP.find(c => c.dst === sortState.col);
  if (!colDef) return;
  const dir = sortState.dir === 'asc' ? 1 : -1;
  currentRows.sort((a, b) => {
    const va = a[sortState.col], vb = b[sortState.col];
    const ea = va === '' || va == null;
    const eb = vb === '' || vb == null;
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    if (colDef.type === 'num') {
      const na = parseFloat(va), nb = parseFloat(vb);
      if (isNaN(na) && isNaN(nb)) return 0;
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return (na - nb) * dir;
    }
    return String(va).localeCompare(String(vb), 'ja') * dir;
  });
}

function renderTable() {
  const thead = document.querySelector('#dataTable thead');
  const tbody = document.querySelector('#dataTable tbody');
  const empty = document.getElementById('emptyHint');
  if (currentRows.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';
  thead.innerHTML = '<tr>' + COLUMN_MAP.map(c => {
    const isSort = sortState.col === c.dst;
    const arrow = isSort
      ? `<span class="sort-arrow active">${sortState.dir === 'asc' ? '▲' : '▼'}</span>`
      : '<span class="sort-arrow">⇅</span>';
    const cls = isSort ? ' class="sorted"' : '';
    return `<th data-col="${c.dst}"${cls}>${escapeHtml(c.dst)}${arrow}</th>`;
  }).join('') + '</tr>';
  thead.querySelectorAll('th').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (sortState.col === col) sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      else { sortState.col = col; sortState.dir = 'asc'; }
      sortRows();
      renderTable();
    });
  });
  tbody.innerHTML = currentRows.map(r => {
    // Team列の値をそのまま色付けに使う (走力ランキングはデータ自体に Team があるので推定不要)
    const team = (r['Team'] || '').trim();
    const teamColor = team && TEAM_COLORS[team] ? TEAM_COLORS[team] : '';
    return '<tr>' + COLUMN_MAP.map(c => {
      if (c.dst === 'Player' && teamColor) {
        return `<td style="color:${teamColor}" data-team="${team}">${escapeHtml(r[c.dst] || '')}</td>`;
      }
      if (c.dst === 'Team' && teamColor) {
        return `<td style="color:${teamColor}">${escapeHtml(r[c.dst] || '')}</td>`;
      }
      return `<td>${escapeHtml(formatCell(r[c.dst], c))}</td>`;
    }).join('') + '</tr>';
  }).join('');
}

function formatCell(val, c) {
  if (val == null || val === '') return '';
  if (c.dst === '日付') {
    const m = String(val).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${+m[2]}/${+m[3]}` : val;
  }
  if (c.decimals != null) {
    const n = parseFloat(val);
    if (!isNaN(n)) return n.toFixed(c.decimals);
  }
  return val;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function getPat() { return localStorage.getItem(PAT_KEY) || ''; }
function setPat(p) { localStorage.setItem(PAT_KEY, p); updatePatStatus(); }
function clearPat() { localStorage.removeItem(PAT_KEY); updatePatStatus(); }
function updatePatStatus() {
  const el = document.getElementById('patStatus');
  const p = getPat();
  if (p) el.textContent = `✓ PAT保存済み (...${p.slice(-6)})`;
  else el.textContent = '⚠ PAT未設定 → 履歴読み込み・コミット不可';
}

function utf8ToBase64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function base64ToUtf8(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

async function ghFetch(path, opts = {}) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(opts.headers || {})
  };
  const pat = getPat();
  if (pat) headers['Authorization'] = `Bearer ${pat}`;
  const res = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}${path}`, { ...opts, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`GitHub API ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

async function listDataFiles() {
  try {
    const items = await ghFetch(`/contents/${DATA_DIR}`);
    return items
      .filter(i => i.type === 'file' && i.name.endsWith('.csv'))
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch (e) {
    console.warn('履歴取得失敗:', e.message);
    return [];
  }
}

async function fetchFile(path) {
  const item = await ghFetch(`/contents/${path}`);
  return base64ToUtf8(item.content);
}

async function commitFile(filename, content) {
  if (!getPat()) throw new Error('GitHub PAT未設定');
  const body = {
    message: `Upload ${filename}`,
    content: utf8ToBase64(content)
  };
  return ghFetch(`/contents/${DATA_DIR}/${filename}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function setStatus(msg, kind) {
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = kind || '';
}

async function loadHistory(autoLoad = true) {
  const sel = document.getElementById('historySelect');
  sel.innerHTML = '<option>読み込み中...</option>';
  const files = await listDataFiles();
  if (files.length === 0) {
    sel.innerHTML = '<option value="">(履歴なし)</option>';
    return;
  }
  sel.innerHTML = files.map(f =>
    `<option value="${f.path}">${f.name}</option>`
  ).join('');
  if (autoLoad) await loadFromRepo(files[0].path);
}

async function loadFromRepo(path) {
  setStatus(`${path} を読み込み中...`);
  try {
    const text = await fetchFile(path);
    currentRows = csvToRows(text);
    sortState = { col: 'H-1st (秒)', dir: 'asc' };
    sortRows();
    renderTable();
    setStatus(`${path} を表示中 (${currentRows.length}件)`, 'success');
  } catch (e) {
    setStatus(`読み込みエラー: ${e.message}`, 'error');
  }
}

async function handlePaste(text) {
  if (!text || !text.trim()) {
    setStatus('テキストを貼り付けてください', 'error');
    return;
  }
  setStatus('解析中...');
  currentRows = csvToRows(text);
  if (currentRows.length === 0) {
    setStatus('有効な行がありません(ヘッダ列名と項目欠損を確認)', 'error');
    renderTable();
    return;
  }
  sortState = { col: 'H-1st (秒)', dir: 'asc' };
  sortRows();
  renderTable();
  setStatus(`表示完了 (${currentRows.length}件)、保存中...`);

  const csvText = textToCsv(text);
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
    const filename = `${ts}.csv`;
    await commitFile(filename, csvText);
    setStatus(`✓ ${filename} を保存しました (${currentRows.length}件)`, 'success');
    await loadHistory(false);
    document.getElementById('historySelect').value = `${DATA_DIR}/${filename}`;
  } catch (e) {
    setStatus(`保存エラー: ${e.message} (表示は完了)`, 'error');
  }
}

function textToCsv(text) {
  const delim = detectDelim(text);
  if (delim === ',') return text;
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) { out.push(''); continue; }
    const fields = line.split('\t').map(f => {
      if (/[",\n]/.test(f)) return '"' + f.replace(/"/g, '""') + '"';
      return f;
    });
    out.push(fields.join(','));
  }
  return out.join('\n');
}

document.getElementById('pasteRunBtn').addEventListener('click', () => {
  handlePaste(document.getElementById('pasteInput').value);
});
document.getElementById('pasteClearBtn').addEventListener('click', () => {
  document.getElementById('pasteInput').value = '';
  document.getElementById('pasteInput').focus();
});
document.getElementById('pasteInput').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    handlePaste(document.getElementById('pasteInput').value);
  }
});

document.getElementById('historySelect').addEventListener('change', e => {
  if (e.target.value) loadFromRepo(e.target.value);
});

document.getElementById('reloadBtn').addEventListener('click', () => loadHistory(true));

document.getElementById('patSaveBtn').addEventListener('click', () => {
  const v = document.getElementById('patInput').value.trim();
  if (v) {
    setPat(v);
    document.getElementById('patInput').value = '';
    setStatus('PATを保存しました', 'success');
    loadHistory(true);
  }
});
document.getElementById('patClearBtn').addEventListener('click', () => {
  if (confirm('保存済みPATを削除しますか?')) {
    clearPat();
    setStatus('PATをクリアしました');
  }
});

updatePatStatus();
loadHistory(true);
