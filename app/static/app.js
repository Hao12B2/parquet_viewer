/* Parquet Viewer frontend — vanilla JS, event delegation (no inline path strings).
   FIX root cause: trước đây path được nhúng trực tiếp vào onclick='...',
   backslash Windows (D:\data\...) bị JS hiểu thành escape sequence -> click không ăn. */
const S = { file: null, schema: null, page: 1, pageSize: 100, sort: [], visible: null, filters: [], totalPages: 0 };
const D = { a: null, b: null, keys: [], compareCols: [], commonCols: [], page: 1, pageSize: 100, totalPages: 0, mode: "side" };
const SA = { page: 1, totalPages: 0 };
const SB = { page: 1, totalPages: 0 };
let FILES = [];
let HIDDEN = [];            // stash file ẨN TẠM (hoàn tác được)
const hiddenPaths = new Set(); // chặn hiện lại khi Quét thư mục (chỉ cho ẩn tạm)
// Blacklist ẨN VĨNH VIỄN: không hoàn tác, Quét lại cũng không hiện, nhớ qua localStorage
const blockedPaths = new Set(loadBlocked());
function loadBlocked() {
  try { return JSON.parse(localStorage.getItem("pv_blocked") || "[]"); }
  catch (e) { return []; }
}
function saveBlocked() {
  try { localStorage.setItem("pv_blocked", JSON.stringify([...blockedPaths])); }
  catch (e) { /* private mode: bỏ qua */ }
}
const $ = (id) => document.getElementById(id);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const esc = (v) => v === null || v === undefined ? "<i class='text-gray-600'>null</i>"
  : String(v).length > 120 ? escapeHtml(String(v)).slice(0, 120) + "…" : escapeHtml(String(v));
const short = (p) => !p ? "—" : p.length > 70 ? "…" + p.slice(-70) : p;
const FILE_ICON = `<svg class="inline-block w-3.5 h-3.5 mr-1 -mt-0.5" viewBox="0 0 16 16" fill="none"><rect x="2" y="1.5" width="12" height="13" rx="2" fill="#065f46" stroke="#34d399"/><line x1="5" y1="5.5" x2="11" y2="5.5" stroke="#6ee7b7" stroke-width="1.4" stroke-linecap="round"/><line x1="5" y1="8.5" x2="11" y2="8.5" stroke="#6ee7b7" stroke-width="1.4" stroke-linecap="round" opacity=".6"/><line x1="5" y1="11.5" x2="9" y2="11.5" stroke="#6ee7b7" stroke-width="1.4" stroke-linecap="round" opacity=".6"/></svg>`;

async function api(url, body, method) {
  const opts = body === undefined && !method ? {} : { method: method || "POST", headers: {"Content-Type":"application/json"}, body: body === undefined ? undefined : JSON.stringify(body) };
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || ("HTTP " + r.status));
  return j;
}
async function apiDelete(url) {
  const r = await fetch(url, { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.detail || ("HTTP " + r.status));
  return j;
}
function showErr(msg) { const e = $("errBox"); if (!msg) { e.classList.add("hidden"); return; } e.textContent = "⚠ " + msg; e.classList.remove("hidden"); }
function showDiffErr(msg) { const e = $("diffErr"); if (!msg) { e.classList.add("hidden"); return; } e.textContent = "⚠ " + msg; e.classList.remove("hidden"); }

// ---------- tabs
function switchTab(t) {
  const single = t === "single";
  $("view-single").classList.toggle("hidden", !single);
  $("view-single").classList.toggle("flex", single);
  $("view-diff").classList.toggle("hidden", single);
  $("view-diff").classList.toggle("flex", !single);
  $("tab-single").className = "px-3 py-1.5 rounded-lg text-sm font-semibold " + (single ? "bg-emerald-600" : "bg-gray-800 hover:bg-gray-700");
  $("tab-diff").className = "px-3 py-1.5 rounded-lg text-sm font-semibold " + (!single ? "bg-emerald-600" : "bg-gray-800 hover:bg-gray-700");
  // Vao Diff View -> luon mac dinh che do Song song (an toan, khong join)
  if (!single) setDiffMode("side");
}

// ---------- sidebar: file list (delegation, dùng index — không nhúng path vào HTML)
function visibleFiles() {
  const q = ($("searchFile").value || "").toLowerCase();
  return FILES.map((f, idx) => ({ f, idx })).filter(({ f }) => f.name.toLowerCase().includes(q));
}
function renderFileList() {
  const list = visibleFiles();
  $("fileCount").textContent = `${list.length} file${list.length !== FILES.length ? ` (lọc từ ${FILES.length})` : ""} • ẩn tạm ${HIDDEN.length}`;
  $("hiddenCount").textContent = HIDDEN.length;
  $("undoHideBtn").classList.toggle("hidden", !HIDDEN.length);
  $("fileList").innerHTML = list.map(({ f, idx }) => {
    const hl = S.file === f.path ? "bg-gray-800 border-emerald-700" : "";
    return `
    <div data-idx="${idx}" data-act="view" title="${escapeHtml(f.path)}"
      class="px-2.5 py-1.5 rounded-lg cursor-pointer text-[12.5px] hover:bg-gray-800 border border-transparent ${hl}
      ${D.a === f.path ? "!border-emerald-600" : ""} ${D.b === f.path ? "!border-sky-600" : ""}">
      <div class="font-medium truncate">${FILE_ICON}${escapeHtml(f.name)}${f.source === "upload" ? '<span class="chip bg-purple-900 text-purple-200 ml-1" title="Bản copy trong thư mục uploads/ của app (Upload chỉ gửi nội dung file, server phải lưu lại mới đọc được)">copy</span>' : ""}</div>
      <div class="text-[11px] text-gray-500">${escapeHtml(f.size_human || "?")} • ${escapeHtml(f.mtime_human || "")}
        ${D.a === f.path ? ' • <span class="text-emerald-400 font-bold">A</span>' : ""}${D.b === f.path ? ' • <span class="text-sky-400 font-bold">B</span>' : ""}</div>
      <div class="flex gap-1 mt-1">
        <button data-idx="${idx}" data-act="setA" title="Chon lam File A de so sanh" class="text-[11px] px-2.5 py-0.5 rounded font-bold ${D.a === f.path ? "bg-emerald-600" : "bg-gray-700 hover:bg-emerald-700 text-emerald-200"}">A</button>
        <button data-idx="${idx}" data-act="setB" title="Chon lam File B de so sanh" class="text-[11px] px-2.5 py-0.5 rounded font-bold ${D.b === f.path ? "bg-sky-600" : "bg-gray-700 hover:bg-sky-700 text-sky-200"}">B</button>
        <button data-idx="${idx}" data-act="hide" title="ẨN TẠM khỏi danh sách (hoàn tác được, KHÔNG xóa file)" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold">✕ ẨN</button>
        <button data-idx="${idx}" data-act="block" title="ẨN KHỎI DANH SÁCH (không hoàn tác được; Quét lại hoặc upload lại sẽ thấy)" class="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 hover:bg-orange-900 text-orange-300 font-bold border border-orange-800">🚫 ẨN LUÔN</button>
        <button data-idx="${idx}" data-act="del" title="XÓA THẬT file khỏi ổ đĩa (xác nhận 2 bước)" class="text-[10px] px-1.5 py-0.5 rounded bg-red-900 hover:bg-red-700 text-red-100 font-bold border border-red-600">🗑 XÓA</button>
      </div>
    </div>`;
  }).join("") || `<div class="text-xs text-gray-500 px-2">Không có file nào. Nhập thư mục rồi bấm Quét, hoặc Upload file.</div>`;
}
// Một listener duy nhất cho cả list — path lấy từ FILES[idx], không parse từ HTML
$("fileList").addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-act]");
  if (!el) return;
  const idx = parseInt(el.dataset.idx, 10);
  const entry = FILES[idx];
  if (!entry) return;
  const act = el.dataset.act;
  if (act === "view") {
    // Tab Diff: click dong = tu gan file con lai (A roi toi B) + tu chay so sanh
    if (!$("view-diff").classList.contains("hidden")) smartDiffPick(entry.path);
    else viewFile(entry.path);
  }
  else if (act === "setA") setDiffFile("a", entry.path);
  else if (act === "setB") setDiffFile("b", entry.path);
  else if (act === "hide") hideFile(idx);
  else if (act === "block") blockFile(idx);
  else if (act === "del") openDelModal(idx);
});

// Quet thu muc (path lay tu dialog native). Bo check paste.
async function browse(directory) {
  if (!directory) return;
  try {
    const j = await api("/api/browse", { directory, recursive: $("recursive").checked });
    const fresh = j.files.filter((f) => !hiddenPaths.has(f.path));
    let unblocked = 0;
    for (const f of fresh) {
      if (blockedPaths.has(f.path)) { blockedPaths.delete(f.path); unblocked++; }
    }
    if (unblocked) saveBlocked();
    const seen = new Set(fresh.map((f) => f.path));
    const kept = FILES.filter((f) => !seen.has(f.path));
    FILES = [...fresh, ...kept];
    renderFileList();
  } catch (e) { alert("Quét lỗi: " + e.message); }
}
function hideFile(idx) {
  const [rm] = FILES.splice(idx, 1);
  if (!rm) return;
  HIDDEN.push(rm); hiddenPaths.add(rm.path);
  afterRemove(rm.path);
  renderFileList();
}
// Ẩn hàng loạt toàn bộ file đang hiện (tôn trọng ô lọc tên) — khỏi ẩn từng file
function hideAll() {
  const idxs = new Set(visibleFiles().map(({ idx }) => idx));
  if (!idxs.size) return;
  const removed = FILES.filter((_, i) => idxs.has(i));
  FILES = FILES.filter((_, i) => !idxs.has(i));
  for (const f of removed) { HIDDEN.push(f); hiddenPaths.add(f.path); }
  for (const f of removed) afterRemove(f.path);
  renderFileList();
}
// Hiện lại toàn bộ file ẨN TẠM (không đụng tới file đã ẨN VĨNH VIỄN)
function undoHide() {
  if (!HIDDEN.length) return;
  for (const f of HIDDEN) hiddenPaths.delete(f.path);
  FILES = [...FILES, ...HIDDEN].sort((a, b) => a.name.localeCompare(b.name));
  HIDDEN = [];
  renderFileList();
}
// ẨN VĨNH VIỄN 1 file: chặn luôn, Quét lại cũng không hiện, Hoàn tác không khôi phục
function blockFile(idx) {
  const [rm] = FILES.splice(idx, 1);
  if (!rm) return;
  blockedPaths.add(rm.path); saveBlocked();
  afterRemove(rm.path);
  renderFileList();
}
function afterRemove(path) {
  if (S.file === path) clearSingleView();
  let diffTouched = false;
  if (D.a === path) { D.a = null; D.keys = []; $("fileA").textContent = "—"; diffTouched = true; }
  if (D.b === path) { D.b = null; $("fileB").textContent = "—"; diffTouched = true; }
  if (diffTouched) clearDiffOutputs();
}
// Ẩn/xóa file đang xem -> trắng toàn bộ bảng, schema, filter (khỏi sót UI cũ gây hiểu lầm)
function clearSingleView() {
  S.file = null; S.schema = null; S.page = 1; S.visible = null; S.sort = []; S.filters = [];
  $("curFile").textContent = "— chưa chọn —";
  $("statLine").textContent = "";
  $("schemaMeta").textContent = "";
  $("schemaChips").innerHTML = "";
  $("colPanel").innerHTML = ""; $("colPanel").classList.add("hidden");
  $("filterRows").innerHTML = "";
  $("queryBar").value = "";
  $("filterMsg").textContent = "";
  $("pageInfo").textContent = "–";
  $("thead").innerHTML = "";
  $("tbody").innerHTML = "";
  showErr(null);
}
// File A/B bị ẩn/xóa -> trắng kết quả so sánh cũ
function clearDiffOutputs() {
  D.keys = []; D.compareCols = []; D.page = 1; SA.page = 1; SB.page = 1;
  $("fileA").textContent = short(D.a); $("fileB").textContent = short(D.b);
  $("keyPicker").innerHTML = ""; $("comparePicker").innerHTML = "";
  $("schemaDiff").innerHTML = "Chưa so sánh schema. Bấm nút <b class=\"text-emerald-400\">A</b> / <b class=\"text-sky-400\">B</b> ở danh sách file để gán, rồi bấm So sánh.";
  $("dthead").innerHTML = ""; $("dtbody").innerHTML = "";
  $("athead").innerHTML = ""; $("atbody").innerHTML = "";
  $("bthead").innerHTML = ""; $("btbody").innerHTML = "";
  $("sideAPath").textContent = "—"; $("sideBPath").textContent = "—";
  $("diffPageInfo").textContent = "–"; $("diffMeta").textContent = "";
  showDiffErr(null);
}
let pendingDelIdx = null, pendingDelPath = null, delArmed = false, delTimer = null;
function openDelModal(idx) {
  const entry = FILES[idx];
  if (!entry) return;
  pendingDelIdx = idx; pendingDelPath = entry.path; delArmed = false;
  if (delTimer) { clearTimeout(delTimer); delTimer = null; }
  $("delName").textContent = entry.name;
  $("delPath").textContent = entry.path;
  $("delNote").innerHTML = entry.source === "upload"
    ? `Đây là <b class="text-purple-300">bản copy tạm</b> trong thư mục uploads/session-*/ của app — xóa chỉ mất bản copy (bản này tự xóa khi tắt/mở lại app), <b>file gốc của bạn không bị ảnh hưởng</b>.`
    : `Đây là <b class="text-red-300">file gốc trên ổ đĩa</b> — xóa là mất thật.`;
  const btn = $("delConfirmBtn");
  btn.textContent = "Tôi hiểu rủi ro — tiếp tục";
  btn.className = "px-4 py-2 rounded-lg font-bold bg-red-800 hover:bg-red-700 text-red-100 border border-red-500";
  $("delModal").classList.remove("hidden");
  $("delModal").classList.add("flex");
}
function closeDelModal() {
  $("delModal").classList.add("hidden");
  $("delModal").classList.remove("flex");
  pendingDelIdx = null; pendingDelPath = null; delArmed = false;
  if (delTimer) { clearTimeout(delTimer); delTimer = null; }
}
async function delModalConfirm() {
  // Buoc 2: nut phai duoc bam 2 lan (arm roi moi xoa) — chong bam nham
  const btn = $("delConfirmBtn");
  if (!delArmed) {
    delArmed = true;
    btn.textContent = "⚠ BẤM LẦN NỮA để XÓA VĨNH VIỄN";
    btn.className = "px-4 py-2 rounded-lg font-bold bg-red-600 hover:bg-red-500 text-white border-2 border-red-300 animate-pulse";
    delTimer = setTimeout(() => {
      delArmed = false;
      btn.textContent = "Tôi hiểu rủi ro — tiếp tục";
      btn.className = "px-4 py-2 rounded-lg font-bold bg-red-800 hover:bg-red-700 text-red-100 border border-red-500";
    }, 5000);
    return;
  }
  const path = pendingDelPath; // khoa theo PATH tu luc mo modal (list co doi thu tu cung dung)
  if (!path) return closeDelModal();
  btn.textContent = "Đang xóa…";
  try {
    await apiDelete("/api/file?path=" + encodeURIComponent(path) + "&from_disk=true");
    closeDelModal();
    removeFileByPath(path);
  } catch (e) { btn.textContent = "Lỗi: " + e.message + " — bấm Hủy"; }
}
// Go file khoi list theo PATH (an toan ca khi list doi thu tu)
function removeFileByPath(path) {
  const i = FILES.findIndex((x) => x.path === path);
  if (i >= 0) FILES.splice(i, 1);
  const h = HIDDEN.findIndex((x) => x.path === path);
  if (h >= 0) { HIDDEN.splice(h, 1); hiddenPaths.delete(path); }
  afterRemove(path);
  renderFileList();
}
// File bi xoa NGOAI app (vd: xoa tay trong folder) -> tu go khoi list kem bao ro.
// CHI ap dung cho loi PATH (file mat that), KHONG ap dung cho "Cot khong ton tai"
// (truong hop filter cu cua file khac con sot lai khi doi file).
function purgeIfMissing(path, msg) {
  if (!path || !/đường dẫn không tồn tại|file không tồn tại/i.test(msg || "")) return false;
  removeFileByPath(path);
  return true;
}
async function viewFile(path) {
  saveFileState();
  const st = FILE_STATE[path];
  S.file = path;
  // Khôi phục đúng trạng thái đã làm việc dở của file này (nếu có), mừng file mới thì mặc định
  S.page = st ? st.page : 1;
  S.visible = st ? (st.visible ? [...st.visible] : null) : null;
  S.sort = st ? JSON.parse(JSON.stringify(st.sort)) : [];
  S.filters = st ? JSON.parse(JSON.stringify(st.filters)) : [];
  $("queryBar").value = st ? st.query : "";
  D.a = path; $("fileA").textContent = short(path);
  $("curFile").textContent = path;
  renderFileList(); await loadSchema(); renderFilterRows(); await loadData(); autoKeys();
}
// Nhớ trạng thái filter/sort/cột/trang theo từng file để quay lại vẫn còn
const FILE_STATE = {};
function saveFileState() {
  if (!S.file) return;
  FILE_STATE[S.file] = {
    filters: JSON.parse(JSON.stringify(S.filters)),
    query: $("queryBar").value,
    sort: JSON.parse(JSON.stringify(S.sort)),
    visible: S.visible ? [...S.visible] : null,
    page: S.page,
  };
  const ks = Object.keys(FILE_STATE);
  if (ks.length > 100) delete FILE_STATE[ks[0]]; // chống phình vô hạn
}
function smartDiffPick(path) {
  if (!D.a || D.a === path) {
    if (!D.a) { D.a = path; D.keys = []; $("fileA").textContent = short(path); }
  } else {
    D.b = path; $("fileB").textContent = short(path);
  }
  renderFileList(); autoKeys();
}
function setDiffFile(which, path) {
  if (which === "a") { D.a = path; D.keys = []; $("fileA").textContent = short(path); }
  else { D.b = path; $("fileB").textContent = short(path); }
  renderFileList(); autoKeys();
}
function swapAB() {
  [D.a, D.b] = [D.b, D.a]; D.keys = [];
  $("fileA").textContent = short(D.a); $("fileB").textContent = short(D.b);
  renderFileList(); autoKeys();
}
async function uploadFiles(inp) {
  const files = [...(inp.files || [])];
  if (!files.length) return;
  let firstPath = null;
  for (const f of files) {
    if (!f.name.toLowerCase().endsWith(".parquet")) { alert(`Bỏ qua ${f.name}: chỉ nhận .parquet`); continue; }
    const fd = new FormData(); fd.append("f", f);
    try {
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json(); if (!r.ok) throw new Error(j.detail);
      // Upload lại file đang CHẶN / ẨN TẠM = muốn thấy lại -> gỡ khỏi cả hai và hiện
      if (blockedPaths.has(j.path)) { blockedPaths.delete(j.path); saveBlocked(); }
      if (hiddenPaths.has(j.path)) {
        HIDDEN = HIDDEN.filter((x) => x.path !== j.path);
        hiddenPaths.delete(j.path);
      }
      if (!FILES.some((x) => x.path === j.path))
        FILES.unshift({ name: j.name || j.filename, path: j.path, size_human: j.size_human || ((f.size / 1024).toFixed(1) + " KB"), mtime_human: j.mtime_human || "vừa upload", source: j.source || "upload" });
      firstPath = firstPath || j.path;
    } catch (e) { alert("Upload lỗi " + f.name + ": " + e.message); }
  }
  inp.value = "";
  renderFileList();
  if (firstPath) viewFile(firstPath); // chọn file upload đầu tiên để xem ngay
}


// (Bo chuc nang paste path: dung nut bam "Chon file..." de lay file goc.)

// Hop thoai native (tkinter phia server) — lay path THAT, khong copy
async function pickFolderNative() {
  try {
    const j = await api("/api/dialog/folder", undefined, "GET");
    if (j.cancelled || !j.path) return;
    browse(j.path);
  } catch (e) { alert(e.message); }
}
async function pickFilesNative() {
  try {
    const j = await api("/api/dialog/files", undefined, "GET");
    if (j.cancelled || !j.paths || !j.paths.length) return;
    let first = null; const errors = [];
    for (const p of j.paths) {
      try { const e = await api("/api/add-path", { path: p }); mergeEntry(e); first = first || e.path; }
      catch (e2) { errors.push(p + ": " + e2.message); }
    }
    if (errors.length) alert("Các file lỗi:\n" + errors.join("\n"));
    renderFileList();
    if (first) viewFile(first);
  } catch (e) { alert(e.message); }
}
// Gop 1 entry vao danh sach (dung chung cho paste path + chon native + upload)
function mergeEntry(j) {
  if (blockedPaths.has(j.path)) { blockedPaths.delete(j.path); saveBlocked(); }
  if (hiddenPaths.has(j.path)) {
    HIDDEN = HIDDEN.filter((x) => x.path !== j.path);
    hiddenPaths.delete(j.path);
  }
  if (!FILES.some((x) => x.path === j.path)) FILES.unshift(j);
}
async function loadSchema() {
  if (!S.file) return;
  try {
    const j = await api("/api/schema?path=" + encodeURIComponent(S.file));
    S.schema = j;
    $("statLine").textContent = `${j.num_rows.toLocaleString()} dòng • ${j.num_cols} cột • ${j.file_size_human}`;
    $("schemaMeta").textContent = `(${j.num_cols} cột)`;
    $("schemaChips").innerHTML = j.columns.map((c, i) =>
      `<span class="chip bg-gray-800 border border-gray-700 cursor-pointer hover:bg-emerald-900 hover:border-emerald-600" data-dc="${i}" title="${escapeHtml(c.dtype)} — bấm để xem giá trị distinct"><b class="text-gray-200">${escapeHtml(c.name)}</b> <span class="text-emerald-400">${escapeHtml(c.dtype)}</span></span>`).join("");
    renderColPanel();
    if (!S.filters.length) { S.filters = []; addFilterRow(); }
  } catch (e) {
    const p = S.file;
    if (purgeIfMissing(p, e.message)) showErr(`File không còn tồn tại trên đĩa — đã tự gỡ khỏi danh sách: ${p}`);
    else showErr(e.message);
  }
}
function renderColPanel() {
  if (!S.schema) return;
  const n = S.schema.columns.length;
  const onCount = !S.visible ? n : S.visible.length;
  $("colPanel").innerHTML =
    `<span class="text-[11px] text-gray-400 mr-1">${onCount}/${n} cột</span>
     <button onclick="selectAllCols()" class="chip bg-gray-800 hover:bg-gray-700 border border-gray-700">chọn hết</button>
     <button onclick="deselectAllCols()" class="chip bg-gray-800 hover:bg-gray-700 border border-gray-700">bỏ hết</button>
     <span class="w-full"></span>` +
    S.schema.columns.map((c, i) => {
      const on = !S.visible || S.visible.includes(c.name);
      return `<label class="chip cursor-pointer border ${on ? "bg-emerald-900 border-emerald-700" : "bg-gray-800 border-gray-700"}">
        <input type="checkbox" data-c="${i}" class="accent-emerald-500 mr-1" ${on ? "checked" : ""}/>${escapeHtml(c.name)}</label>`;
    }).join("");
}
function selectAllCols() {
  if (!S.schema) return;
  S.visible = null; // null = tất cả
  renderColPanel(); S.page = 1; loadData();
}
function deselectAllCols() {
  if (!S.schema) return;
  S.visible = []; // mảng rỗng = không cột nào (backend phân biệt với null)
  S.sort = []; // sort cột ẩn đi cũng vô nghĩa → gỡ luôn
  renderColPanel(); S.page = 1; loadData();
}
$("schemaChips").addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-dc]");
  if (!el) return;
  openDistinctModal(parseInt(el.dataset.dc, 10));
});

// ---------- Distinct modal: xem tổ hợp distinct + tần suất của 1 hoặc nhiều cột
function openDistinctModal(colIdx) {
  if (!S.file || !S.schema) return showErr("Chưa chọn file");
  const col = S.schema.columns[colIdx];
  if (!col) return;
  $("distinctModal").dataset.sel = JSON.stringify([col.name]);
  $("distinctApplyFilters").checked = true;
  $("distinctModal").classList.remove("hidden");
  $("distinctModal").classList.add("flex");
  renderDistinctPicker();
  loadDistinct();
}
function closeDistinctModal() {
  $("distinctModal").classList.add("hidden");
  $("distinctModal").classList.remove("flex");
}
function distinctSelCols() {
  try { return JSON.parse($("distinctModal").dataset.sel || "[]"); }
  catch { return []; }
}
function renderDistinctPicker() {
  if (!S.schema) return;
  const sel = distinctSelCols();
  $("distinctColPicker").innerHTML = S.schema.columns.map((c, i) =>
    `<label class="chip cursor-pointer border ${sel.includes(c.name) ? "bg-sky-900 border-sky-700" : "bg-gray-800 border-gray-700"}">
      <input type="checkbox" data-di="${i}" class="accent-sky-500 mr-1" ${sel.includes(c.name) ? "checked" : ""}/>${escapeHtml(c.name)}</label>`).join("");
  $("distinctColPicker").dataset.all = JSON.stringify(S.schema.columns.map(c => c.name));
}
function distinctColsNone() {
  $("distinctModal").dataset.sel = JSON.stringify([]);
  renderDistinctPicker();
  loadDistinct();
}
$("distinctColPicker").addEventListener("change", (ev) => {
  const cb = ev.target.closest("[data-di]");
  if (!cb || !S.schema) return;
  const all = JSON.parse($("distinctColPicker").dataset.all || "[]");
  const name = all[parseInt(cb.dataset.di, 10)];
  let sel = distinctSelCols();
  sel = cb.checked ? [...new Set([...sel, name])] : sel.filter(x => x !== name);
  $("distinctModal").dataset.sel = JSON.stringify(sel);
  renderDistinctPicker();
  loadDistinct();
});
async function loadDistinct() {
  const cols = distinctSelCols();
  if (!cols.length || !S.file) {
    $("distinctHead").innerHTML = `<th class="text-left">Giá trị</th><th class="text-right">Số dòng</th>`;
    $("distinctBody").innerHTML = `<tr><td colspan="2" class="text-center text-gray-500 py-4">Tick ít nhất 1 cột để xem.</td></tr>`;
    $("distinctFoot").textContent = "";
    $("distinctTitle").textContent = "Distinct";
    return;
  }
  const apply = $("distinctApplyFilters").checked;
  const colspan = cols.length + 1;
  $("distinctHead").innerHTML = cols.map(c => `<th class="text-left">${escapeHtml(c)}</th>`).join("") + `<th class="text-right">Số dòng</th>`;
  $("distinctBody").innerHTML = `<tr><td colspan="${colspan}" class="text-center text-amber-300 py-4">⏳ Đang tính...</td></tr>`;
  $("distinctFoot").textContent = "";
  $("distinctTitle").textContent = `Distinct: ${cols.join(", ")}`;
  try {
    const j = await api("/api/distinct", {
      path: S.file,
      columns: cols,
      limit: parseInt($("distinctLimit").value, 10) || 1000,
      filters: apply ? S.filters.filter(f => ["is_null", "is_not_null", "strip_eq", "strip_contains"].includes(f.op) || String(f.value ?? "") !== "").map(f => ({ column: f.column, op: f.op, value: f.value, value2: f.value2 || null, logic: f.logic })) : undefined,
      query: apply ? $("queryBar").value.trim() || undefined : undefined,
    });
    $("distinctBody").innerHTML = j.rows.map(r =>
      `<tr>${j.columns.map(c => `<td title="${escapeHtml(String(r[c] ?? ""))}">${esc(r[c])}</td>`).join("")}<td class="text-right text-emerald-300">${r.count.toLocaleString()}</td></tr>`
    ).join("") || `<tr><td colspan="${colspan}" class="text-center text-gray-500 py-4">Không có dữ liệu.</td></tr>`;
    $("distinctFoot").textContent = `${j.total_distinct.toLocaleString()} tổ hợp distinct` +
      (j.truncated ? ` — chỉ hiện top ${j.limit.toLocaleString()} theo tần suất` : "") +
      (apply && (S.filters.length || $("queryBar").value.trim()) ? " (theo filter hiện tại)" : "");
  } catch (e) {
    $("distinctBody").innerHTML = `<tr><td colspan="${colspan}" class="text-center text-red-400 py-4">⚠ ${escapeHtml(e.message)}</td></tr>`;
  }
}
$("colPanel").addEventListener("change", (ev) => {
  const cb = ev.target.closest("[data-c]");
  if (!cb || !S.schema) return;
  const name = S.schema.columns[parseInt(cb.dataset.c, 10)].name;
  if (!S.visible) S.visible = S.schema.columns.map((c) => c.name);
  S.visible = cb.checked ? [...new Set([...S.visible, name])] : S.visible.filter((c) => c !== name);
  renderColPanel(); S.page = 1; loadData();
});
function toggleCols() { $("colPanel").classList.toggle("hidden"); }
const OPS = ["=", "!=", ">", "<", ">=", "<=", "between", "in", "not_in", "contains", "not_contains", "starts_with", "not_starts_with", "ends_with", "not_ends_with", "regex", "not_regex", "is_null", "is_not_null", "slice_eq", "slice_contains", "strip_eq", "strip_contains"];
const OPS_NEED_VALUE2 = ["between", "slice_eq", "slice_contains", "strip_eq", "strip_contains"];
function opValuePlaceholder(op) {
  if (op === "in" || op === "not_in") return "vd: VNM, VCB, HPG";
  if (op === "slice_eq" || op === "slice_contains") return "vd: 3,1 (offset,length)";
  if (op === "strip_eq" || op === "strip_contains") return "ký tự strip (trống = khoảng trắng)";
  if (op === "between") return "giá trị min";
  if (op === "regex" || op === "not_regex") return "vd: ^VN\\d+$";
  return "giá trị";
}
function opValue2Placeholder(op) {
  if (op === "between") return "giá trị max";
  if (op === "slice_eq") return "chuỗi mong đợi vd: X";
  if (op === "slice_contains") return "chuỗi con cần chứa";
  if (op === "strip_eq") return "chuỗi mong đợi sau strip";
  if (op === "strip_contains") return "chuỗi con sau strip";
  return "value2 (between)";
}
function addFilterRow() {
  if (!S.schema) return showErr("Chọn file trước khi thêm filter");
  S.filters.push({ column: S.schema.columns[0].name, op: "=", value: "", logic: "AND" });
  renderFilterRows();
}
function renderFilterRows() {
  const cols = S.schema ? S.schema.columns.map((c) => c.name) : [];
  $("filterRows").innerHTML = S.filters.map((f, i) => `
    <div class="flex gap-1.5 items-center text-[13px]">
      ${i > 0 ? `<select data-fi="${i}" data-fk="logic" class="bg-gray-800 rounded px-1.5 py-1 text-xs w-[70px]">
        <option ${f.logic === "AND" ? "selected" : ""}>AND</option><option ${f.logic === "OR" ? "selected" : ""}>OR</option></select>` : `<span class="text-[11px] text-gray-500 w-[70px]">WHERE</span>`}
      <select data-fi="${i}" data-fk="column" class="bg-gray-800 rounded px-1.5 py-1 max-w-[180px]">${cols.map((c) => `<option ${c === f.column ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}</select>
      <select data-fi="${i}" data-fk="op" class="bg-gray-800 rounded px-1.5 py-1">${OPS.map((o) => `<option ${o === f.op ? "selected" : ""}>${o}</option>`).join("")}</select>
      <input data-fi="${i}" data-fk="value" value="${escapeHtml(f.value ?? "")}" placeholder="${opValuePlaceholder(f.op)}" title="${(f.op === "in" || f.op === "not_in") ? "Tập giá trị cách nhau dấu phẩy" : (f.op === "slice_eq" || f.op === "slice_contains") ? "offset tính từ 0, vd 3,1 = ký tự thứ 4 lấy 1 ký tự" : (f.op === "strip_eq" || f.op === "strip_contains") ? "Để trống = strip khoảng trắng" : "Giá trị so sánh"}" class="bg-gray-800 rounded px-2 py-1 w-40 outline-none"/>
      <input data-fi="${i}" data-fk="value2" value="${escapeHtml(f.value2 ?? "")}" placeholder="${opValue2Placeholder(f.op)}" class="bg-gray-800 rounded px-2 py-1 w-36 outline-none" ${OPS_NEED_VALUE2.includes(f.op) ? "" : 'style="display:none"'} />
      <button data-fdel="${i}" class="text-red-400 hover:text-red-300 px-1">✕</button>
    </div>`).join("");
}
$("filterRows").addEventListener("change", (ev) => {
  const el = ev.target.closest("[data-fi]");
  if (!el) return;
  S.filters[parseInt(el.dataset.fi, 10)][el.dataset.fk] = el.value;
  if (el.dataset.fk === "op") renderFilterRows(); // refresh placeholder vd: in/not_in
});
$("filterRows").addEventListener("input", (ev) => {
  const el = ev.target.closest("[data-fi]");
  if (!el) return;
  S.filters[parseInt(el.dataset.fi, 10)][el.dataset.fk] = el.value;
});
$("filterRows").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-fdel]");
  if (!b) return;
  S.filters.splice(parseInt(b.dataset.fdel, 10), 1); renderFilterRows();
  S.page = 1; loadData(); // xóa filter -> chạy lại ngay để kết quả khớp filter còn lại
});
$("filterRows").addEventListener("keydown", (ev) => {
  // Enter trong ô giá trị -> chạy filter luôn (SELECT giữ hành vi native mở dropdown)
  if (ev.key === "Enter" && ev.target && ev.target.tagName === "INPUT") {
    ev.preventDefault();
    applyFilters();
  }
});
function applyFilters() { S.page = 1; loadData(); }
function clearFilters() { S.filters = []; $("queryBar").value = ""; renderFilterRows(); S.page = 1; loadData(); }
function prevPage() { if (S.page > 1) { S.page--; loadData(); } }
function nextPage() { if (S.page < S.totalPages) { S.page++; loadData(); } }
// Multi-sort: click cot = THEM sort (giu sort cu, cot dau = khoa chinh).
// Click lai cung cot: dao chieu. Click lan 3: go sort cot do.
function sortBy(col) {
  const i = S.sort.findIndex((s) => s.column === col);
  if (i < 0) S.sort.push({ column: col, dir: "asc" });
  else if (S.sort[i].dir === "asc") S.sort[i].dir = "desc";
  else S.sort.splice(i, 1);
  S.page = 1; loadData();
}
function clearSort() { S.sort = []; S.page = 1; loadData(); }
async function loadData() {
  if (!S.file) return;
  showErr(null);
  S.pageSize = parseInt($("pageSize").value, 10);
  const payload = {
    path: S.file, page: S.page, page_size: S.pageSize,
    sort: S.sort,
    columns: S.visible, query: $("queryBar").value.trim() || null,
    filters: S.filters.filter((f) => ["is_null", "is_not_null", "strip_eq", "strip_contains"].includes(f.op) || String(f.value ?? "") !== "").map((f) => ({ column: f.column, op: f.op, value: f.value, value2: f.value2 || null, logic: f.logic })),
  };
  $("filterMsg").textContent = payload.filters.length || payload.query ? `• ${payload.filters.length} filter UI${payload.query ? " + custom expr" : ""} (chạy trên LazyFrame)` : "";
  try {
    const j = await api("/api/data", payload);
    S.totalPages = j.total_pages;
    $("pageInfo").textContent = `${j.total_rows.toLocaleString()} dòng • trang ${j.page}/${Math.max(j.total_pages, 1)}`;
    $("clearSortBtn").classList.toggle("hidden", !S.sort.length);
    $("thead").innerHTML = j.columns.map((c, i) => {
      const si = S.sort.findIndex((s) => s.column === c);
      const mark = si < 0 ? "" : (S.sort[si].dir === "asc" ? " ▲" : " ▼") + (S.sort.length > 1 ? (si + 1) : "");
      return `<th data-sort="${i}" title="Click: thêm sort (giữ sort cũ) • Click lại: đảo chiều • Click lần 3: gỡ sort">${escapeHtml(c)}<span class="text-emerald-400">${mark}</span><br><span class="font-normal text-gray-500 text-[10px]">${escapeHtml(j.dtypes[c] || "")}</span></th>`;
    }).join("");
    // lưu columns để delegation sort tra cứu theo index
    $("thead").dataset.cols = JSON.stringify(j.columns);
    $("thead").querySelectorAll("[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const cols = JSON.parse($("thead").dataset.cols || "[]");
        sortBy(cols[parseInt(th.dataset.sort, 10)]);
      });
    });
    $("tbody").innerHTML = !j.columns.length
      ? `<tr><td class="text-center text-gray-500 py-6">Chưa chọn cột nào — tick lại trong 👁 Cột.</td></tr>`
      : j.rows.map((r) => `<tr>${j.columns.map((c) => `<td title="${escapeHtml(String(r[c] ?? ""))}">${esc(r[c])}</td>`).join("")}</tr>`).join("")
      || `<tr><td class="text-center text-gray-500 py-6">Không có dòng nào khớp filter.</td></tr>`;
  } catch (e) {
    const p = S.file;
    if (purgeIfMissing(p, e.message)) showErr(`File không còn tồn tại trên đĩa — đã tự gỡ khỏi danh sách: ${p}`);
    else showErr(e.message);
  }
}

// ---------- diff view
async function setDiffMode(m) {
  D.mode = m;
  $("modeSide").className = "px-2.5 py-1 rounded-md font-semibold " + (m === "side" ? "bg-emerald-600" : "text-gray-300 hover:bg-gray-700");
  $("modeDiff").className = "px-2.5 py-1 rounded-md font-semibold " + (m === "diff" ? "bg-emerald-600" : "text-gray-300 hover:bg-gray-700");
  $("diffBar").classList.toggle("hidden", m !== "diff");
  $("diffBar").classList.toggle("flex", m === "diff");
  $("diffJoinWrap").classList.toggle("hidden", m !== "diff");
  $("sideWrap").classList.toggle("hidden", m !== "side");
  $("sideWrap").classList.toggle("grid", m === "side");
  // Diff options (PK + compare cols + diffOnly) chi hien khi o mode diff
  $("diffOptions").classList.toggle("hidden", m !== "diff");
  $("diffOptions").classList.toggle("block", m === "diff");
  // KHONG auto-run join khi chuyen mode.
  // Che do Song song: tu dong so SCHEMA (re, chi metadata) + load 2 bang doc lap.
  if (D.a && D.b) {
    if (m === "side") {
      setDiffLoading(true);
      try {
        const s = await api("/api/compare/schema", { path_a: D.a, path_b: D.b });
        renderSchemaDiff(s);
        await autoKeys();
      } catch (e) { showDiffErr(e.message); }
      await Promise.all([loadSide("a"), loadSide("b")]);
      setDiffLoading(false);
    }
    if (m === "diff") $("dthead").innerHTML = '<tr><th class="text-gray-400 font-normal">Bấm nút So sánh để chạy join</th></tr>';
  }
}
async function autoKeys() {
  if (!D.a || !D.b) return;
  try {
    const j = await api("/api/compare/schema", { path_a: D.a, path_b: D.b });
    renderSchemaDiff(j);
    D.commonCols = j.common_columns;
    // PK: mac dinh 1 cot neu chua co
    if (!D.keys.length) D.keys = j.common_columns.slice(0, 1);
    D.keys = D.keys.filter((k) => j.common_columns.includes(k));
    $("keyPicker").innerHTML = j.common_columns.map((c, i) =>
      `<label class="chip cursor-pointer border ${D.keys.includes(c) ? "bg-emerald-900 border-emerald-700" : "bg-gray-800 border-gray-700"}">
        <input type="checkbox" data-k="${i}" class="accent-emerald-500 mr-1" ${D.keys.includes(c) ? "checked" : ""}/>${escapeHtml(c)}</label>`).join("")
      || `<span class="text-xs text-red-400">Không có cột chung — không thể join theo key.</span>`;
    $("keyPicker").dataset.cols = JSON.stringify(j.common_columns);
    // Compare columns: mac dinh chi chon 2 cot non-key common (tranh OOM khi user khong chinh sua)
    const nonKeyCommon = j.common_columns.filter((c) => !D.keys.includes(c));
    if (!D.compareCols.length || !D.compareCols.every((c) => nonKeyCommon.includes(c))) {
      D.compareCols = nonKeyCommon.slice(0, 2);
    }
    renderComparePicker();
  } catch (e) { $("keyPicker").innerHTML = `<span class="text-xs text-red-400">${escapeHtml(e.message)}</span>`; }
}
// Picker chon cot so sanh (non-key common cols)
function renderComparePicker() {
  const nonKey = D.commonCols.filter((c) => !D.keys.includes(c));
  if (!nonKey.length) {
    $("comparePicker").innerHTML = `<span class="text-xs text-gray-500">Tất cả cột chung đều là Primary Key — không có cột để so sánh.</span>`;
    return;
  }
  $("comparePicker").innerHTML = nonKey.map((c, i) =>
    `<label class="chip cursor-pointer border ${D.compareCols.includes(c) ? "bg-sky-900 border-sky-700" : "bg-gray-800 border-gray-700"}">
      <input type="checkbox" data-c="${i}" class="accent-sky-500 mr-1" ${D.compareCols.includes(c) ? "checked" : ""}/>${escapeHtml(c)}</label>`).join("");
  $("comparePicker").dataset.cols = JSON.stringify(nonKey);
}
function compareColsAll() {
  D.compareCols = D.commonCols.filter((c) => !D.keys.includes(c));
  renderComparePicker();
}
function compareColsNone() {
  D.compareCols = [];
  renderComparePicker();
}
$("keyPicker").addEventListener("change", (ev) => {
  const cb = ev.target.closest("[data-k]");
  if (!cb) return;
  const cols = JSON.parse($("keyPicker").dataset.cols || "[]");
  const k = cols[parseInt(cb.dataset.k, 10)];
  D.keys = cb.checked ? [...new Set([...D.keys, k])] : D.keys.filter((x) => x !== k);
  // Sau khi doi PK, compareCols can loai bo cot vua thanh key
  D.compareCols = D.compareCols.filter((c) => !D.keys.includes(c));
  autoKeys();
});
$("comparePicker").addEventListener("change", (ev) => {
  const cb = ev.target.closest("[data-c]");
  if (!cb) return;
  const cols = JSON.parse($("comparePicker").dataset.cols || "[]");
  const c = cols[parseInt(cb.dataset.c, 10)];
  D.compareCols = cb.checked ? [...new Set([...D.compareCols, c])] : D.compareCols.filter((x) => x !== c);
  renderComparePicker();
});
function diffPrev() { if (D.page > 1) { D.page--; runCompare(true); } }
function diffNext() { if (D.page < D.totalPages) { D.page++; runCompare(true); } }
function sidePrev(w) { const st = w === "a" ? SA : SB; if (st.page > 1) { st.page--; loadSide(w); } }
function sideNext(w) { const st = w === "a" ? SA : SB; if (st.page < st.totalPages) { st.page++; loadSide(w); } }

async function runCompare(keep = false) {
  showDiffErr(null);
  if (!D.a || !D.b) return showDiffErr("Chưa đủ 2 file: bấm nút A / B ở danh sách file để gán (hiện tại A=" + short(D.a) + ", B=" + short(D.b) + ").");
  // Canh bao memory truoc khi join: inner join phinh theo (matched_rows x cols x 16 bytes).
  // Uoc luong matched_rows <= min(num_rows_a, num_rows_b).
  if (D.mode !== "side") {
    const aMeta = FILES.find((f) => f.path === D.a);
    const bMeta = FILES.find((f) => f.path === D.b);
    const aRows = aMeta?.num_rows || 0, bRows = bMeta?.num_rows || 0;
    const nCompare = D.compareCols.length;
    const nKeys = D.keys.length;
    // matched_rows upper bound: min(a, b). Moi dong join: keys + 2*compare cols.
    const estMatched = Math.min(aRows, bRows);
    const estBytes = estMatched * (nKeys + 2 * nCompare) * 16;
    const estGB = estBytes / (1024 ** 3);
    if (estGB > 0.5) {
      const pct = ((1 - nCompare / Math.max(1, (aMeta?.file_size || 1) / 200_000))).toFixed(0); // heuristic
      const msg = `⚠ So sánh này có thể tốn ~${estGB.toFixed(1)} GB RAM\n\n` +
        `• Matched: ${estMatched.toLocaleString()} dòng (ước lượng tối đa)\n` +
        `• Cột so sánh đã chọn: ${nCompare} (${D.compareCols.join(", ")})\n` +
        `• Cột key: ${nKeys}\n\n` +
        `Khuyến nghị: BỎ CHỌN bớt cột ở mục "Cột so sánh" (chỉ giữ 1-2 cột cần xem diff) để giảm RAM.`;
      if (!confirm(msg + "\n\nBấm OK để chạy với cảnh báo này, Cancel để quay lại bỏ bớt cột.")) return;
    }
  }
  if (D.mode === "side") {
    if (!keep) { SA.page = 1; SB.page = 1; }
    setDiffLoading(true);
    try {
      const s = await api("/api/compare/schema", { path_a: D.a, path_b: D.b });
      renderSchemaDiff(s);
      await autoKeys();
    } catch (e) { setDiffLoading(false); return showDiffErr(e.message); }
    await Promise.all([loadSide("a"), loadSide("b")]);
    setDiffLoading(false);
    return;
  }
  // diff-join mode
  if (!keep) D.page = 1;
  D.pageSize = parseInt($("pageSize").value, 10);
  setDiffLoading(true);
  try {
    const s = await api("/api/compare/schema", { path_a: D.a, path_b: D.b });
    renderSchemaDiff(s);
    await autoKeys();
    if (!D.keys.length) return closeDiffLoadingWithErr("Chọn ít nhất 1 cột Primary Key.");
    const j = await api("/api/compare/data", {
      path_a: D.a, path_b: D.b,
      keys: D.keys,
      compare_columns: D.compareCols,
      coalesce_null_keys: $("coalesceNullPK").checked,
      page: D.page, page_size: D.pageSize,
      diff_only: $("diffOnly").checked,
    });
    D.totalPages = j.total_pages;
    $("diffPageInfo").textContent = j.capped
      ? `⚠ hiện ${j.total_rows.toLocaleString()} dòng đầu (capped từ ${j.cap_limit.toLocaleString()}) • trang ${j.page}/${Math.max(j.total_pages, 1)}`
      : `${j.total_rows.toLocaleString()} dòng lệch • trang ${j.page}/${Math.max(j.total_pages, 1)}`;
    $("diffMeta").textContent = `keys: ${j.keys.join(", ")} • ${j.non_key_common.length} cột so sánh: ${j.non_key_common.join(", ")} • n_matched_diff=${j.n_matched_diff} only_a=${j.n_only_in_a} only_b=${j.n_only_in_b}`;
    // CANH BAO THONG MINH: neu "only A/B" chiem > 10% tong rows -> PK qua rong, can review
    const totalRows = (j.n_matched_diff || 0) + (j.n_only_in_a || 0) + (j.n_only_in_b || 0);
    const onlyFrac = totalRows > 0 ? Math.max(j.n_only_in_a || 0, j.n_only_in_b || 0) / totalRows : 0;
    const totalFileRows = Math.max(s.file_a.num_rows, s.file_b.num_rows);
    const diffFrac = totalFileRows > 0 ? totalRows / totalFileRows : 0;
    if (onlyFrac > 0.1 || (diffFrac > 0.5 && totalRows > 1000)) {
      const pct = (onlyFrac * 100).toFixed(0);
      $("schemaDiff").innerHTML += `<div class="mt-2 px-2 py-1.5 bg-amber-950 border border-amber-700 rounded text-amber-200">⚠ <b>${pct}% diff là 'only A/B'</b> — thường do Primary Key quá rộng (${j.keys.length} cột). Nếu chỉ muốn so sánh ${j.non_key_common.join(", ")}, hãy <b>giảm PK còn 1-2 cột unique</b> (vd id). Nếu PK có NULL, bật <b>🔗 NULL PK = nhau</b> bên dưới.</div>`;
    }
    // Xep cap cot cung ten LIEN KE: key (1 cot) + tung cap A|B canh nhau de de so
    const headKeys = j.keys.map((k) => `<th>${escapeHtml(k)}<br><span class="font-normal text-amber-400 text-[10px]">🔑 key</span></th>`).join("");
    const headPairs = j.non_key_common.map((c) =>
      `<th class="!border-l-2 !border-l-emerald-600">${escapeHtml(c)}<br><span class="font-normal text-emerald-500 text-[10px]">A</span></th>` +
      `<th>${escapeHtml(c)}<br><span class="font-normal text-sky-500 text-[10px]">B</span></th>`).join("");
    $("dthead").innerHTML = `<th>status</th>` + headKeys + headPairs;
    $("dtbody").innerHTML = j.rows.map((r) => {
      const cls = r._status === "only_in_a" ? "row-only-a" : r._status === "only_in_b" ? "row-only-b" : r._status === "modified" ? "row-modified" : "";
      const badge = r._status === "same" ? `<span class="chip bg-gray-800">same</span>` : r._status === "only_in_a" ? `<span class="chip bg-amber-900">only A</span>` : r._status === "only_in_b" ? `<span class="chip bg-sky-900">only B</span>` : `<span class="chip bg-red-900">modified</span>`;
      const tdsKeys = j.keys.map((k) => `<td title="${escapeHtml(String(r[k] ?? ""))}">${esc(r[k])}</td>`).join("");
      const tdsPairs = j.non_key_common.map((c) => {
        const cb = `${c}_b`;
        const diff = r._cell_diff && r._cell_diff[c];
        return `<td class="${diff ? "cell-diff " : ""}!border-l-2 !border-l-emerald-600" title="${escapeHtml(String(r[c] ?? ""))}">${esc(r[c])}</td>` +
          `<td class="${diff ? "cell-diff" : ""}" title="${escapeHtml(String(r[cb] ?? ""))}">${esc(r[cb])}</td>`;
      }).join("");
      return `<tr class="${cls}"><td>${badge}</td>${tdsKeys}${tdsPairs}</tr>`;
    }).join("") || `<tr><td class="text-center text-emerald-300 py-6">Không có chênh lệch — 2 file khớp nhau trên keys đã chọn.</td></tr>`;
    setDiffLoading(false);
  } catch (e) { setDiffLoading(false); showDiffErr(e.message); }
}

// Loading state cho compare: spinner + disable buttons
function setDiffLoading(on) {
  const ids = ["diffLoading", "diffPrevBtn", "diffNextBtn", "diffOnly"];
  $("diffLoading").classList.toggle("hidden", !on);
  ["diffPrevBtn", "diffNextBtn", "diffOnly"].forEach((id) => {
    const el = $(id); if (el) el.disabled = on;
  });
}
function closeDiffLoadingWithErr(msg) {
  setDiffLoading(false);
  return showDiffErr(msg);
}
function renderSchemaDiff(s) {
  $("schemaDiff").innerHTML =
    `<span class="text-gray-400">A: ${s.file_a.num_rows.toLocaleString()} dòng/${s.file_a.num_cols} cột • B: ${s.file_b.num_rows.toLocaleString()} dòng/${s.file_b.num_cols} cột</span><br>` +
    (s.only_in_a.length ? `<span class="chip bg-amber-900 text-amber-200 mr-1">Chỉ ở A: ${s.only_in_a.map(escapeHtml).join(", ")}</span>` : "") +
    (s.only_in_b.length ? `<span class="chip bg-sky-900 text-sky-200 mr-1">Chỉ ở B: ${s.only_in_b.map(escapeHtml).join(", ")}</span>` : "") +
    s.dtype_mismatch.map((m) => `<span class="chip bg-red-900 text-red-200 mr-1">${escapeHtml(m.column)}: ${escapeHtml(m.dtype_a)} → ${escapeHtml(m.dtype_b)}</span>`).join("") +
    (!s.only_in_a.length && !s.only_in_b.length && !s.dtype_mismatch.length ? `<span class="chip bg-emerald-900 text-emerald-200">Schema khớp 100%</span>` : "");
}
// Side-by-side: đọc FULL content 2 file độc lập (paginated), không phải chỉ dòng diff
async function loadSide(w) {
  const path = w === "a" ? D.a : D.b;
  const st = w === "a" ? SA : SB;
  const head = $(w === "a" ? "athead" : "bthead"), body = $(w === "a" ? "atbody" : "btbody");
  $(w === "a" ? "sideAPath" : "sideBPath").textContent = short(path);
  if (!path) { body.innerHTML = `<tr><td class="text-gray-500 py-6">Chưa gán file ${w.toUpperCase()}.</td></tr>`; return; }
  try {
    const j = await api("/api/data", { path, page: st.page, page_size: parseInt($("pageSize").value, 10) });
    st.totalPages = j.total_pages;
    $(w === "a" ? "sideAPage" : "sideBPage").textContent = `${j.total_rows.toLocaleString()} dòng • tr.${j.page}/${Math.max(j.total_pages, 1)}`;
    head.innerHTML = j.columns.map((c) => `<th>${escapeHtml(c)}<br><span class="font-normal text-gray-500 text-[10px]">${escapeHtml(j.dtypes[c] || "")}</span></th>`).join("");
    body.innerHTML = j.rows.map((r) => `<tr>${j.columns.map((c) => `<td title="${escapeHtml(String(r[c] ?? ""))}">${esc(r[c])}</td>`).join("")}</tr>`).join("")
      || `<tr><td class="text-center text-gray-500 py-6">File rỗng.</td></tr>`;
  } catch (e) {
    if (purgeIfMissing(path, e.message)) body.innerHTML = `<tr><td class="text-amber-300 py-6">⚠ File không còn tồn tại trên đĩa — đã tự gỡ khỏi danh sách.</td></tr>`;
    else body.innerHTML = `<tr><td class="text-red-400 py-6">⚠ ${escapeHtml(e.message)}</td></tr>`;
  }
}

// Icon (?) → panel tooltip day du. Dung position:fixed de khong bi sidebar cat.
function buildHelpTooltip() {
  const html = `
    <div class="space-y-2 text-[12.5px] leading-snug text-gray-100">
      <div><b>Xem file:</b> click tên file trong danh sách.</div>
      <div><b>So sánh A vs B:</b> sang tab Diff View → click file 1 (gán A) rồi click file 2 (gán B + tự so sánh), hoặc bấm nút <span class="text-emerald-400 font-bold">A</span>/<span class="text-sky-400 font-bold">B</span> trên dòng file. Nút <b>⇄</b> đảo A↔B.</div>
      <div><b>Sort:</b> click tiêu đề cột để thêm sort. Click lần 2 = đảo chiều. Click lần 3 = gỡ. Nút <b>↕ Xóa sort</b> gỡ hết.</div>
      <div><b>Bộ lọc:</b> mỗi điều kiện = cột + phép toán + giá trị. AND/OR giữa các điều kiện. Ô Polars expr ở dưới cho Data Engineer.</div>
      <div><b>Distinct:</b> bấm tên cột trong SCHEMA để xem các giá trị distinct + tần suất.</div>
      <div class="border-t border-gray-700 pt-1.5">
        <b>ẨN/XÓA trên mỗi dòng file:</b>
        <ul class="list-disc pl-5 mt-1 space-y-0.5">
          <li><b>✕ ẨN</b> — ẩn tạm, bấm <b>↩ Hoàn tác</b> là hiện lại.</li>
          <li><b class="text-orange-300">🚫 ẨN LUÔN</b> — ẩn khỏi list, <b>không hoàn tác</b>. Quét/Chọn lại là thấy.</li>
          <li><b class="text-red-400">🗑 XÓA</b> — xóa thật (hỏi 2 bước). File nhãn tím <span class="text-purple-300">copy</span> = xóa bản copy; file thường = xóa file gốc.</li>
        </ul>
      </div>
    </div>`;
  const tip = document.createElement("div");
  tip.id = "helpTooltip";
  tip.className = "hidden fixed z-[100] w-[360px] bg-gray-900 border border-emerald-700 rounded-lg p-3 shadow-2xl";
  tip.innerHTML = html + `<div class="text-right mt-2"><button class="text-xs text-gray-400 hover:text-white" onclick="$('helpTooltip').classList.add('hidden')">đóng ✕</button></div>`;
  document.body.appendChild(tip);
  // Vi tri tooltip: canh phai ?, neo phia duoi.
  const place = () => {
    const r = $("helpInfo").getBoundingClientRect();
    const w = 360, h = tip.offsetHeight || 320;
    let left = r.right - w;
    if (left < 8) left = 8;
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = r.top - h - 6;
    if (top < 8) top = 8;
    tip.style.left = left + "px";
    tip.style.top = top + "px";
  };
  const show = () => { place(); tip.classList.remove("hidden"); };
  const hide = () => tip.classList.add("hidden");
  $("helpInfo").addEventListener("click", (e) => { e.stopPropagation(); tip.classList.contains("hidden") ? show() : hide(); });
  document.addEventListener("click", hide);
  window.addEventListener("resize", () => { if (!tip.classList.contains("hidden")) place(); });
}

// ---------- Export modal (state RIÊNG, không dùng chung D.compareCols của Diff View)
function openExportModal() {
  if (!S.file) return showErr("Chưa chọn file để xuất");
  const cols = S.visible && S.visible.length ? S.visible : (S.schema ? S.schema.columns.map(c => c.name) : []);
  $("exportColPicker").innerHTML = cols.map((c, i) => `
    <label class="chip cursor-pointer border bg-emerald-900 border-emerald-700">
      <input type="checkbox" data-ec="${i}" class="accent-emerald-500 mr-1" checked/>${escapeHtml(c)}</label>
  `).join("");
  $("exportColPicker").dataset.cols = JSON.stringify(cols);
  $("exportPageSize").value = 0;
  $("exportApplyFilters").checked = true;
  $("exportModal").classList.remove("hidden");
  $("exportModal").classList.add("flex");
}
function closeExportModal() {
  $("exportModal").classList.add("hidden");
  $("exportModal").classList.remove("flex");
}
function exportColsAll() {
  $("exportColPicker").querySelectorAll("input[data-ec]").forEach(cb => { cb.checked = true; });
  paintExportPicker();
}
function exportColsNone() {
  $("exportColPicker").querySelectorAll("input[data-ec]").forEach(cb => { cb.checked = false; });
  paintExportPicker();
}
function paintExportPicker() {
  $("exportColPicker").querySelectorAll("label.chip").forEach(lb => {
    const on = lb.querySelector("input[data-ec]").checked;
    lb.className = "chip cursor-pointer border " + (on ? "bg-emerald-900 border-emerald-700" : "bg-gray-800 border-gray-700");
  });
}
$("exportColPicker").addEventListener("change", () => paintExportPicker());
function getExportCols() {
  const cols = JSON.parse($("exportColPicker").dataset.cols || "[]");
  return [...$("exportColPicker").querySelectorAll("input[data-ec]:checked")]
    .map(cb => cols[parseInt(cb.dataset.ec, 10)])
    .filter(c => typeof c === "string" && c !== "");
}
async function doExport() {
  if (!S.file) return showErr("Chưa chọn file");
  const format = document.querySelector('input[name="exportFormat"]:checked').value;
  const cols = getExportCols();
  if (!cols.length) return showErr("Hãy chọn ít nhất 1 cột để xuất");
  const applyFilters = $("exportApplyFilters").checked;
  const payload = {
    path: S.file,
    format: format,
    page: 1,
    page_size: parseInt($("exportPageSize").value) || 0,
    columns: cols,
    sort: S.sort.length ? S.sort : undefined,
    filters: applyFilters ? S.filters.filter(f => ["is_null", "is_not_null", "strip_eq", "strip_contains"].includes(f.op) || String(f.value ?? "") !== "").map(f => ({ column: f.column, op: f.op, value: f.value, value2: f.value2 || null, logic: f.logic })) : undefined,
    query: applyFilters ? $("queryBar").value.trim() || null : null,
    sort_by: S.sort.length ? S.sort[0].column : undefined,
    sort_dir: S.sort.length ? S.sort[0].dir : "asc",
  };
  const btn = $("exportConfirmBtn");
  btn.disabled = true;
  btn.textContent = "Đang xuất...";
  try {
    const r = await fetch("/api/export", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error(await exportErrorText(r));
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `export_${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
    closeExportModal();
  } catch (e) {
    showErr("Xuất file lỗi: " + exportErrMsg(e));
  } finally {
    btn.disabled = false;
    btn.textContent = "Xuất file";
  }
}
// Parse lỗi backend: detail có thể là string, mảng validation-error (422), hoặc response không phải JSON
async function exportErrorText(r) {
  try {
    const j = await r.json();
    const d = j.detail;
    if (Array.isArray(d)) return d.map(x => (x && (x.msg || x.message)) || JSON.stringify(x)).join("; ");
    return d || ("HTTP " + r.status);
  } catch {
    try { const t = await r.text(); return t.slice(0, 200) || ("HTTP " + r.status); }
    catch { return "HTTP " + r.status; }
  }
}
function exportErrMsg(e) {
  if (typeof e === "string") return e;
  if (e && typeof e.message === "string" && e.message) return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

// ---------- init
setDiffMode("side");
buildHelpTooltip();
fetch("/api/health").then((r) => r.json()).then((j) => $("health").textContent = "● backend ok" + (j.version ? " v" + j.version : "")).catch(() => $("health").textContent = "○ backend chưa chạy?");

