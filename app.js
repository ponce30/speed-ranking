const REPO_OWNER = 'ponce30';
const REPO_NAME = 'speed-ranking';
const DATA_DIR = 'data';
const PAT_KEY = 'speed-ranking:pat';

const COLUMN_MAP = [
  { src: 'Rk',                  dst: 'Rk',                       type: 'num' },
  { src: 'Player',              dst: 'Player',                   type: 'str' },
  { src: 'H-1st (avg)',         dst: 'H-1st (平均)',             type: 'num' },
  { src: 'SB',                  dst: 'SB',                       type: 'num' },
  { src: 'H-1st (min)',         dst: 'H-1st (最速)',             type: 'num' },
  { src: '1st-2nd Steal (avg)', dst: '1st-2nd 盗塁(平均)',       type: 'num' },
  { src: '1st-2nd Steal (min)', dst: '1st-2nd 盗塁 (最速)',      type: 'num' },
  { src: 'SS (max)',            dst: 'スプリントスピード(max)',  type: 'num' },
];

let currentRows = [];
let sortState = { col: 'Rk', dir: 'asc' };

function parseCSV(text) {
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
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; }
      else if (c === '\r') {}
      else field += c;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); lines.push(row); }
  return lines.filter(r => r.some(v => v !== ''));
}

function csvToRows(text) {
  const lines = parseCSV(text);
  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());
  const idxs = COLUMN_MAP.map(c => headers.indexOf(c.src));
  const missing = COLUMN_MAP.filter((c, j) => idxs[j] < 0).map(c => c.src);
  if (missing.length > 0) {
    console.warn('未検出の列:', missing);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const row = {};
    COLUMN_MAP.forEach((c, j) => {
      const idx = idxs[j];
      row[c.dst] = idx >= 0 ? (lines[i][idx] ?? '') : '';
    });
    rows.push(row);
  }
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
    const arrow = isSort ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    const cls = isSort ? ' class="sorted"' : '';
    return `<th data-col="${c.dst}"${cls}>${c.dst}${arrow}</th>`;
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
  tbody.innerHTML = currentRows.map(r =>
    '<tr>' + COLUMN_MAP.map(c => `<td>${escapeHtml(r[c.dst] ?? '')}</td>`).join('') + '</tr>'
  ).join('');
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
    sortState = { col: 'Rk', dir: 'asc' };
    sortRows();
    renderTable();
    setStatus(`${path} を表示中 (${currentRows.length}件)`, 'success');
  } catch (e) {
    setStatus(`読み込みエラー: ${e.message}`, 'error');
  }
}

async function handleUpload(file) {
  if (!file.name.toLowerCase().endsWith('.csv')) {
    setStatus('CSVファイルのみ対応', 'error');
    return;
  }
  setStatus(`${file.name} を解析中...`);
  let text;
  try {
    text = await file.text();
  } catch (e) {
    setStatus(`ファイル読み込みエラー: ${e.message}`, 'error');
    return;
  }
  currentRows = csvToRows(text);
  if (currentRows.length === 0) {
    setStatus('データ行が見つかりません(列名が一致するか確認)', 'error');
    return;
  }
  sortState = { col: 'Rk', dir: 'asc' };
  sortRows();
  renderTable();
  setStatus(`${file.name} 表示完了 (${currentRows.length}件)、保存中...`);
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
    const filename = `${ts}.csv`;
    await commitFile(filename, text);
    setStatus(`✓ ${filename} を保存しました (${currentRows.length}件)`, 'success');
    await loadHistory(false);
    document.getElementById('historySelect').value = `${DATA_DIR}/${filename}`;
  } catch (e) {
    setStatus(`保存エラー: ${e.message}`, 'error');
  }
}

document.getElementById('fileInput').addEventListener('change', e => {
  if (e.target.files[0]) handleUpload(e.target.files[0]);
});

const dz = document.getElementById('dropzone');
['dragenter', 'dragover'].forEach(ev =>
  dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); })
);
['dragleave', 'drop'].forEach(ev =>
  dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); })
);
dz.addEventListener('drop', e => {
  const f = e.dataTransfer.files[0];
  if (f) handleUpload(f);
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
