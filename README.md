# 📦 Parquet Viewer — Local, hiệu năng cao (FastAPI + Polars)

Xem • So sánh side-by-side • Lọc power-filter trên file Parquet lớn mà không nổ RAM.

## Kiến trúc

```
parquet_viewer/
├── app/
│   ├── main.py            # FastAPI: REST APIs + serve frontend tĩnh
│   ├── parquet_service.py # Logic lõi: pl.scan_parquet, filter, sort, paginate, diff
│   └── static/
│       ├── index.html     # UI Tailwind: sidebar + single view + diff view
│       ├── app.js         # Fetch API, filter builder, sort, pagination, highlight diff
│       └── favicon.svg    # icon app
├── requirements.txt     # thư viện (launcher tự cài, bắt buộc giữ)
├── run_app.vbs            # double-click: chạy ngầm như desktop app, Windows (khuyên dùng)
├── stop_server.bat        # tắt hẳn server + dọn file upload tạm, Windows
├── run_app.sh             # tương tự run_app.vbs nhưng cho macOS (chạy ./run_app.sh trong Terminal)
├── stop_server.sh         # tương tự stop_server.bat nhưng cho macOS
├── run.bat                # dự phòng: chạy hiện console để xem log, Windows
└── README.md
```

**Nguyên tắc hiệu năng (bắt buộc):**
- Không bao giờ `pl.read_parquet()` full file. Luôn `pl.scan_parquet()` (LazyFrame)
  rồi `.filter(...).sort(...).slice(offset, limit).collect()` — chỉ trang hiện tại vào RAM.
- Đếm dòng bằng `lf.select(pl.len()).collect()` — Polars đọc metadata, không load data.
- Frontend phân trang (50/100/500) + bảng cuộn, không render 1M dòng vào DOM.
- **Diff join (chiến lược hiện tại):** chỉ `select` key + cột so sánh đã chọn (projection pushdown), rồi 2 anti-join (`only A/B`) + 1 inner join + filter (`modified`) — không full outer join. Count + slice chạy streaming, paginate theo từng phần nên chỉ trang đang xem vào RAM (1M dòng ~0.2s). Guard ước lượng RAM trước khi join; cap 100k dòng diff.

## Chạy nhanh (Windows / WSL2)

**Cách 1 — như desktop app (khuyên dùng, không cửa sổ đen):**
- Double-click **`run_app.vbs`** → server chạy ngầm (dùng `pythonw` nếu có, nếu không thì `python.exe` chạy ẩn), tự mở cửa sổ app riêng (Chrome/Edge `--app`, có nút ✕ như phần mềm desktop).
- Đóng cửa sổ app **không** tắt server. Muốn tắt hẳn: chạy **`stop_server.bat`** (tắt server + dọn sạch file upload tạm ngay).
- Xem log khi lỗi: chạy `run.bat`.
- **Dùng miniconda/anaconda:** `run_app.vbs` tự dò `python.exe` trong PATH (và các thư mục cài đặt mặc định `~/miniconda3`, `C:\ProgramData\miniconda3`...). Miniconda **không có `pythonw.exe`** nên script chạy ẩn bằng cửa sổ hidden thay vì `pythonw`. Nếu báo không thấy Python dù `cmd` gõ `python` được: mở Anaconda Prompt gõ `where python`, thêm thư mục đó vào PATH hệ thống rồi đăng nhập lại. Log khởi động nằm ở `server.log` (tự sinh trong thư mục).

**Cách 2 — cửa sổ console (thấy log):** double-click `run.bat`, hoặc:
```bat
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Mở trình duyệt: **http://127.0.0.1:8000**

Bấm **📁 Duyệt thư mục** (chọn thư mục chứa `.parquet`, VD `D:\data\parquet`) hoặc **📄 Chọn file…** để thêm file vào danh sách.

## API

| Method | Endpoint | Mô tả |
|---|---|---|
| POST | `/api/browse` `{directory, recursive}` | Quét file `.parquet`, trả tên/size/mtime |
| GET | `/api/schema?path=...` | Schema, số dòng/cột, dung lượng |
| POST | `/api/data` `{path,page,page_size,sort: [{column,dir}],columns,filters,query}` | Trang dữ liệu đã filter/sort (multi-sort) |
| POST | `/api/compare/schema` | Cột chỉ ở A / chỉ ở B / lệch dtype |
| POST | `/api/compare/data` `{path_a,path_b,keys,page,diff_only}` | Join theo key, highlight ô lệch |
| POST | `/api/upload` | Upload 1 file `.parquet` (UI hỗ trợ chọn nhiều file) |
| POST | `/api/distinct` `{path,columns[],limit,filters,query}` | Tổ hợp distinct + tần suất của 1/nhiều cột |
| DELETE | `/api/file?path=...&from_disk=false` | Ẩn khỏi list (`false`, không đụng ổ đĩa) hoặc **xóa thật** (`true`, chỉ `.parquet`) |

## Thao tác file & so sánh (UI)

- **Xem:** tab Single → click tên file. Panel SCHEMA có thanh cuộn riêng (không còn xổ hết đẩy bảng data nhỏ lại). **Bấm tên cột trong SCHEMA để xem distinct + tần suất** (modal, tick 1 hoặc nhiều cột để xem tổ hợp, top theo count, có tùy chọn theo filter hiện tại). Filter/sort/cột/trang được **nhớ riêng từng file** — đổi qua file khác rồi quay lại vẫn còn nguyên. Thêm file bằng **📁 Duyệt…** (hộp thoại chọn thư mục, quét sẵn) hoặc **📄 Chọn file…** (hộp thoại chọn nhiều file, **lấy file gốc không copy** — dùng `tkinter` chạy ngay trong server local, gọn hơn PowerShell). Nút **Upload** chỉ dùng khi muốn upload nội dung file lên server để xem (gắn nhãn tím `copy`, **tự xóa khi `stop_server.bat` / khởi động lại**). File `.parquet` bạn để thẳng trong `app/uploads/` không bao giờ bị đụng tới.
- **Xóa:** modal xóa nói rõ đang xóa **bản copy** (file gốc an toàn) hay **file gốc** (mất thật).
- **So sánh:** sang tab **Diff View** (mặc định chế độ **⫿ Song song**: tự so SCHEMA + load 2 bảng độc lập, không join) → click file 1 (gán A) rồi click file 2 (tự gán B), hoặc bấm nút **A**/**B** trên từng dòng; nút **⇄** đảo A↔B. Sang **⚡ Diff join** rồi bấm **So sánh** mới chạy join (an toàn file lớn).
- **Xóa/ẩn:** **✕ ẨN** ẩn tạm 1 file; **🙈 Ẩn tất cả đang hiện** ẩn tạm hàng loạt theo ô lọc tên; **↩ Hoàn tác** chỉ hiện lại nhóm ẩn tạm. Ẩn file đang xem sẽ **trắng toàn bộ** bảng/schema/filter của nó (không sót UI cũ). **🚫 ẨN LUÔN** ẩn khỏi danh sách (Hoàn tác không khôi phục; **Quét lại thư mục hoặc upload/thêm lại file đó sẽ thấy và xem được ngay**; nhớ qua lần mở sau nhờ localStorage). **🗑 XÓA** đỏ → modal cảnh báo → bấm xác nhận **2 lần** (hết 5s tự hủy). Dòng đếm hiển thị `Hiện X/Y file • ẩn tạm Z` nên luôn khớp thực tế.
- **Khi nào mất thật, khi nào chỉ mất copy (nút 🗑 XÓA):**
  - File có nhãn tím `copy` (do Upload lên) → chỉ xóa **bản copy** trong `app/uploads/`, **file gốc của bạn còn nguyên**.
  - File thường (từ Quét thư mục / Thêm theo đường dẫn) → xóa **file gốc thật** trên ổ đĩa.
  - Các nút Ẩn (✕, 🙈, 🚫) **không bao giờ xóa file**, chỉ ẩn khỏi danh sách.
  - Xóa file ngoài app (xóa tay trong folder): lần mở tiếp theo app báo "không tồn tại" và **tự gỡ khỏi danh sách**.
- **Diff join:** cột key hiện 1 lần; các cột cùng tên xếp thành cặp **A|B liền kề** (ngăn cách bằng viền xanh) để đối chiếu trực quan.

**Filter UI:** `{column, op, value, value2, logic}` — op gồm
`=,!=,>,<,>=,<=,between,in,not_in,contains,not_contains,starts_with,not_starts_with,ends_with,not_ends_with,regex,not_regex,is_null,is_not_null,slice_eq,slice_contains,strip_eq,strip_contains`,
kết hợp `AND/OR`. Với `in/not_in` nhập tập giá trị cách nhau dấu phẩy, vd `VNM, VCB, HPG`.
Với `slice_eq/slice_contains`: value dạng `offset,length` (offset tính từ 0, vd `3,1` = ký tự thứ 4 lấy 1 ký tự), value2 là chuỗi mong đợi.
Với `strip_eq/strip_contains`: value là ký tự cần strip (để trống = khoảng trắng), value2 là chuỗi mong đợi sau khi strip.
Ô value2 tự ẩn khi op không cần. Backend dựng `pl.Expr` (`is_in`, `~` phủ định, `str.slice`, `str.strip_chars`) và `.filter()` trên LazyFrame.

**Query bar (cho Data Engineer):**
```
pl.col("ticker").str.starts_with("VN") & (pl.col("volume") > 100000)
```
Backend `eval` trong sandbox (`__builtins__` rỗng, chỉ có `pl/col/lit`), chặn
`import/os/sys/exec/open/__`, validate trả về `pl.Expr`, lỗi trả JSON thân thiện.

**Sort & cột:**
- Click tiêu đề cột để **thêm sort** (giữ sort cũ, hiển thị số ưu tiên ▲1 ▲2 khi có nhiều cột). Click lần 2 = đảo chiều. Click lần 3 = gỡ sort cột đó. Nút **↕ Xóa sort** gỡ hết.
- Click checkbox trên chip cột để ẩn/hiện cột (có nút **chọn hết** / **bỏ hết** trong panel 👁 Cột).

**Xuất file (Export):**
- Tab Single View → bấm nút **📥 Export** → chọn định dạng (Excel .xlsx / CSV .csv), số dòng (0 = tất cả), cột muốn xuất.
- Mặc định xuất các cột đang hiển thị + áp dụng filter/sort hiện tại. Có thể bỏ chọn "Áp dụng filter/sort" để xuất dữ liệu gốc.
- Xuất toàn bộ file (page_size = 0) vẫn an toàn nhờ streaming.

**Thêm file (chọn nguồn nhanh):**
- 🟢 **Quét** — quét thư mục, hiện mọi `.parquet`.
- 🟢 **📁 Duyệt…** — hộp thoại Windows chọn thư mục, rồi quét (server chạy local).
- 🟢 **📄 Chọn file…** — hộp thoại Windows chọn **nhiều file**, lấy file gốc, **không copy**.
- 🟡 **Upload** — chỉ khi cần: server lưu bản copy tạm `app/uploads/session-*/` (nhãn tím `copy`, tự xóa khi `stop_server.bat` / khởi động lại).

## Xử lý lỗi
- Đường dẫn sai / file hỏng / expr sai → HTTP 400 + `{"detail": "..."}` → UI hiện banner đỏ, server không crash.

## Chuyển sang máy khác (Windows)

**1. Máy mới cần cài trước:** [Python 3.10+](https://www.python.org/downloads/) (lúc cài đặt nhớ tick **"Add python.exe to PATH"**).
Bản Python từ python.org đã gồm sẵn `tkinter` (để mở hộp thoại 📁 Duyệt / 📄 Chọn file). Dùng miniconda cũng được —
nếu hộp thoại báo thiếu `tkinter` thì chạy `conda install tk` một lần.

**2. Copy folder sang máy mới — CHỈ lấy các file này:**
```
parquet_viewer/
├── app/
│   ├── main.py
│   ├── parquet_service.py
│   ├── __init__.py
│   └── static/          (index.html, app.js, favicon.svg)
├── requirements.txt     (bắt buộc — run_app.vbs tự cài thư viện từ file này)
├── run_app.vbs
├── stop_server.bat
├── run.bat
├── run_app.sh + stop_server.sh   (cho Mac — Windows không cần nhưng cứ để, vô hại)
└── README.md            (file này)
```

**KHÔNG copy các file/thư mục sau** (toàn bộ là file tạm do app tự sinh lại, và có thể chứa dữ liệu thật của bạn):
- `app/uploads/` — toàn bộ (bản copy upload `session-*` + file `.parquet` bạn để trong đó)
- `app/__pycache__/` — cache Python
- `server.log`, `_start_server.bat`, `.app_note_shown` — log/cờ tạm của launcher

> Cách nhanh: nén cả folder thành `.zip`, sang máy mới giải nén rồi **xóa các mục trên** (nếu có).

**3. Chạy lần đầu trên máy mới:** double-click **`run_app.vbs`** → script tự `pip install` thư viện (cần mạng lần đầu, mất 1–2 phút) →
tự mở cửa sổ app. Các lần sau mở ngay. Kiểm tra góc phải header hiện `● backend ok v2.7.1`.

**Lưu ý:**
- App chạy local hoàn toàn (`127.0.0.1:8000`), dữ liệu parquet không upload đi đâu.
- Danh sách "🚫 ẨN LUÔN" lưu ở localStorage của trình duyệt nên **không** theo sang máy mới (máy mới thấy đủ file — ẩn lại nếu cần).
- Mỗi máy mở port `8000` riêng, không ảnh hưởng nhau.

## Chuyển sang MacBook — dùng được, với 3 khác biệt

**Trả lời ngắn: được.** Backend (FastAPI + Polars) và toàn bộ tính năng xem/lọc/sort/so sánh/export chạy y hệt
trên macOS (cả chip Intel lẫn Apple Silicon — `pip` tự lấy đúng wheel). Chỉ khác ở khâu mở app + hộp thoại chọn file:

**1. Cài Python:** tải bản mới nhất từ [python.org](https://www.python.org/downloads/) (đã gồm `tkinter`).
Mở Terminal kiểm tra: `python3 --version`.

**2. Copy folder:** danh sách file lấy/bỏ **giống hệt mục Windows ở trên**, chỉ khác thêm 2 file:
lấy thêm `run_app.sh` + `stop_server.sh`, **bỏ** `run_app.vbs` + `*.bat` (Windows-only, để lại cũng vô hại).

**3. Chạy:** mở Terminal, `cd` vào folder rồi chạy:
```bash
chmod +x run_app.sh stop_server.sh   # chỉ cần 1 lần đầu
./run_app.sh        # cài lib lần đầu, chạy ngầm, tự mở cửa sổ app
./stop_server.sh    # tắt hẳn + dọn file upload tạm
```
Kiểm tra góc phải header hiện `● backend ok v2.7.1`.

**Khác biệt duy nhất đáng chú ý — nút 📁 Duyệt / 📄 Chọn file:**
`tkinter` trên macOS bắt buộc chạy main thread (quy định của Cocoa), mà server lại gọi nó từ worker thread —
thử bừa có thể **crash cả server**. Nên app **chủ động tắt 2 nút này trên Mac** (bấm vào sẽ báo
"Hộp thoại native chưa hỗ trợ trên macOS"). Thay vào đó dùng nút **Upload** (chọn nhiều file, bản copy tạm
tự xóa khi tắt app) — mọi tính năng còn lại dùng bình thường. Khi nào cần duyệt cả thư mục, copy file
`.parquet` vào máy Mac rồi Upload là xong.
