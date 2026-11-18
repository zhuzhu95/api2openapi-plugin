import { fromHarEntry, type CapturedRequest, type HarEntry } from './converter/captured';
import { buildOpenAPI } from './converter/openapi-builder';

const MAX_REQUESTS = 500;
const MAX_BODY_LENGTH = 1_000_000;
const STATIC_EXT = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|webm|mp3|map)(\?|#|$)/i;

const state = {
  requests: [] as CapturedRequest[],
  selected: new Set<string>(),
  paused: false,
  preserveLog: localStorage.getItem('preserveLog') === '1',
  output: '',
  pageTitle: 'Captured API',
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}

const tbody = $<HTMLTableSectionElement>('tbody');
const empty = $('empty');
const stats = $('stats');
const preview = $('preview');
const search = $<HTMLInputElement>('search');
const methodFilter = $<HTMLSelectElement>('methodFilter');
const selectAll = $<HTMLInputElement>('selectAll');
const harBox = $('harBox');
const harInput = $<HTMLTextAreaElement>('harInput');
const preserveLog = $<HTMLInputElement>('preserveLog');

preserveLog.checked = state.preserveLog;

chrome.devtools.inspectedWindow.eval('document.title', (result, err) => {
  if (!err && typeof result === 'string' && result) state.pageTitle = result;
});

function decodeBase64(b64: string): string {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function filtered(): CapturedRequest[] {
  const q = search.value.trim().toLowerCase();
  const m = methodFilter.value;
  return state.requests.filter(
    (r) => (!m || r.method === m) && (!q || r.url.toLowerCase().includes(q)),
  );
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderRows(): void {
  const rows = filtered();
  tbody.textContent = '';
  empty.style.display = state.requests.length ? 'none' : 'block';

  for (const req of rows) {
    const tr = document.createElement('tr');
    if (state.selected.has(req.id)) tr.className = 'selected';

    const tdCheck = document.createElement('td');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.selected.has(req.id);
    cb.addEventListener('change', () => {
      if (cb.checked) state.selected.add(req.id);
      else state.selected.delete(req.id);
      tr.className = cb.checked ? 'selected' : '';
      updateStats();
    });
    tdCheck.appendChild(cb);

    const tdMethod = document.createElement('td');
    tdMethod.textContent = req.method;
    tdMethod.className = `m-${req.method.toLowerCase()}`;

    const tdUrl = document.createElement('td');
    tdUrl.className = 'url';
    tdUrl.textContent = req.url;
    tdUrl.title = req.url;

    const tdStatus = document.createElement('td');
    tdStatus.textContent = String(req.status || '-');
    tdStatus.className = `s-${String(req.status)[0] ?? ''}`;

    const tdSize = document.createElement('td');
    tdSize.textContent = fmtSize(req.responseSize);

    const tdOp = document.createElement('td');
    const btn = document.createElement('button');
    btn.textContent = '转换';
    btn.addEventListener('click', () => convert([req]));
    tdOp.appendChild(btn);

    tr.append(tdCheck, tdMethod, tdUrl, tdStatus, tdSize, tdOp);
    tbody.appendChild(tr);
  }

  selectAll.checked = rows.length > 0 && rows.every((r) => state.selected.has(r.id));
  updateStats();
}

function updateStats(): void {
  stats.textContent = `${state.requests.length} 条请求 · 选中 ${state.selected.size} 条`;
}

let renderQueued = false;
function scheduleRender(): void {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderRows();
  });
}

function pushRequest(req: CapturedRequest, select = false): void {
  if (state.requests.length >= MAX_REQUESTS) {
    const removed = state.requests.shift();
    if (removed) state.selected.delete(removed.id);
  }
  state.requests.push(req);
  if (select) state.selected.add(req.id);
  scheduleRender();
}

function convert(requests: CapturedRequest[]): void {
  if (!requests.length) {
    preview.textContent = '请先勾选至少一条请求。';
    return;
  }
  try {
    const doc = buildOpenAPI(requests, { title: state.pageTitle });
    state.output = JSON.stringify(doc, null, 2);
    preview.textContent = state.output;
  } catch (e) {
    preview.textContent = `转换失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

function convertSelected(): void {
  const ids = state.selected;
  convert(state.requests.filter((r) => ids.has(r.id)));
}

chrome.devtools.network.onRequestFinished.addListener((request) => {
  if (state.paused) return;
  const entry = request as unknown as HarEntry;
  if (STATIC_EXT.test(entry.request.url)) return;
  const rt = entry._resourceType;
  if (rt && rt !== 'xhr' && rt !== 'fetch') return;

  request.getContent((content, encoding) => {
    let body = content ?? '';
    if (encoding === 'base64' && body) {
      try {
        body = decodeBase64(body);
      } catch {
        body = '';
      }
    }
    if (body.length > MAX_BODY_LENGTH) body = '';
    pushRequest(fromHarEntry(entry, body));
  });
});

chrome.devtools.network.onNavigated.addListener(() => {
  if (state.preserveLog) return;
  state.requests = [];
  state.selected.clear();
  renderRows();
});

search.addEventListener('input', renderRows);
methodFilter.addEventListener('change', renderRows);

selectAll.addEventListener('change', () => {
  for (const r of filtered()) {
    if (selectAll.checked) state.selected.add(r.id);
    else state.selected.delete(r.id);
  }
  renderRows();
});

$('toggleCapture').addEventListener('click', (e) => {
  state.paused = !state.paused;
  (e.target as HTMLButtonElement).textContent = state.paused ? '继续' : '暂停';
});

$('clear').addEventListener('click', () => {
  state.requests = [];
  state.selected.clear();
  state.output = '';
  preview.textContent = '';
  renderRows();
});

preserveLog.addEventListener('change', () => {
  state.preserveLog = preserveLog.checked;
  localStorage.setItem('preserveLog', preserveLog.checked ? '1' : '0');
});

$('convert').addEventListener('click', convertSelected);

$('copy').addEventListener('click', async () => {
  if (!state.output) convertSelected();
  if (!state.output) return;
  try {
    await navigator.clipboard.writeText(state.output);
    preview.textContent = `${state.output}\n\n// ✓ 已复制到剪贴板`;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = state.output;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
});

$('download').addEventListener('click', () => {
  if (!state.output) convertSelected();
  if (!state.output) return;
  const blob = new Blob([state.output], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `openapi-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('harToggle').addEventListener('click', () => {
  harBox.hidden = !harBox.hidden;
});

$('harImport').addEventListener('click', () => {
  const raw = harInput.value.trim();
  if (!raw) return;
  let entries: HarEntry[];
  try {
    const data: unknown = JSON.parse(raw);
    if (Array.isArray(data)) entries = data as HarEntry[];
    else if ((data as { log?: { entries?: HarEntry[] } })?.log?.entries)
      entries = (data as { log: { entries: HarEntry[] } }).log.entries;
    else if ((data as HarEntry)?.request) entries = [data as HarEntry];
    else throw new Error('无法识别的 HAR 结构');
  } catch (e) {
    preview.textContent = `HAR 解析失败：${e instanceof Error ? e.message : String(e)}`;
    return;
  }

  let imported = 0;
  for (const entry of entries) {
    if (!entry.request?.url || STATIC_EXT.test(entry.request.url)) continue;
    const content = entry.response?.content;
    let body = content?.text ?? '';
    if (content?.encoding === 'base64' && body) {
      try {
        body = decodeBase64(body);
      } catch {
        body = '';
      }
    }
    if (body.length > MAX_BODY_LENGTH) body = '';
    pushRequest(fromHarEntry(entry, body), true);
    imported++;
  }
  harInput.value = '';
  preview.textContent = `已导入 ${imported} 条请求并自动选中，点击「转换选中」生成 OpenAPI。`;
});

renderRows();
