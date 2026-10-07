"""FastAPI backend — Parquet Viewer local."""
from __future__ import annotations

import platform
import shutil
import threading
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import parquet_service as svc

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# Moi phien chay co id rieng: file upload luu vao session-<id>,
# khoi dong lai thi tu don session cu. File .parquet user tu de
# thang trong uploads/ KHONG BAO GIO bi dung toi.
SESSION_ID = uuid.uuid4().hex[:8]


def clean_old_sessions() -> int:
    """Xoa thu muc session-* cua cac phien truoc. Tra ve so dir da xoa."""
    removed = 0
    try:
        for child in UPLOAD_DIR.iterdir():
            if child.is_dir() and child.name.startswith("session-") \
                    and child.name != f"session-{SESSION_ID}":
                shutil.rmtree(child, ignore_errors=True)
                removed += 1
    except OSError:
        pass
    return removed


@asynccontextmanager
async def lifespan(app: FastAPI):
    clean_old_sessions()
    yield


app = FastAPI(title="Parquet Viewer", version="2.7.1", lifespan=lifespan)


class ExportReq(BaseModel):
    path: str
    format: str = "xlsx"
    page: int = 1
    page_size: int = 0
    sort: list[dict] | None = None
    columns: list[str] | None = None
    filters: list[dict] | None = None
    query: str | None = None
    sort_by: str | None = None
    sort_dir: str = "asc"


class DistinctReq(BaseModel):
    path: str
    column: str | None = None  # 1 cột (giữ tương thích bản cũ)
    columns: list[str] | None = None  # nhiều cột (ưu tiên nếu có)
    limit: int = 1000
    filters: list[dict] | None = None
    query: str | None = None


# ------------------------------------------------ models
class BrowseReq(BaseModel):
    directory: str
    recursive: bool = True


class AddPathReq(BaseModel):
    path: str


class DataReq(BaseModel):
    path: str
    page: int = 1
    page_size: int = 100
    sort_by: str | None = None   # legacy (1 cot) — van ho tro
    sort_dir: str = "asc"
    sort: list[dict] | None = None  # multi-sort: [{column, dir}] — uu tien hon sort_by
    columns: list[str] | None = None
    filters: list[dict] | None = None
    query: str | None = None


class CompareSchemaReq(BaseModel):
    path_a: str
    path_b: str


class CompareDataReq(BaseModel):
    path_a: str
    path_b: str
    keys: list[str]
    page: int = 1
    page_size: int = 100
    diff_only: bool = True
    compare_columns: list[str] | None = None  # user chon cu the cot nao de so sanh
    coalesce_null_keys: bool = False  # True: NULL trong PK duoc xem la bang nhau


def err(e: Exception, code: int = 400):
    raise HTTPException(status_code=code, detail=str(e))


# ------------------------------------------------ APIs
@app.post("/api/browse")
def browse(req: BrowseReq):
    try:
        files = svc.list_parquet_files(req.directory, req.recursive)
        return {"directory": req.directory, "count": len(files), "files": files}
    except NotADirectoryError as e:
        err(e, 404)
    except Exception as e:
        err(e)


@app.get("/api/schema")
def schema(path: str):
    try:
        return svc.get_schema_info(path)
    except FileNotFoundError as e:
        err(e, 404)
    except Exception as e:
        err(e)


@app.post("/api/data")
def data(req: DataReq):
    try:
        return svc.query_data(
            req.path, req.page, req.page_size, req.sort_by,
            req.sort_dir, req.columns, req.filters, req.query, req.sort,
        )
    except (FileNotFoundError, ValueError) as e:
        err(e, 400)
    except Exception as e:
        err(e, 500)


@app.post("/api/compare/schema")
def compare_schema(req: CompareSchemaReq):
    try:
        return svc.compare_schemas(req.path_a, req.path_b)
    except Exception as e:
        err(e)


@app.post("/api/compare/data")
def compare_data(req: CompareDataReq):
    try:
        return svc.compare_data(
            req.path_a, req.path_b, req.keys, req.page, req.page_size,
            req.diff_only, req.compare_columns, req.coalesce_null_keys,
        )
    except ValueError as e:
        err(e, 400)
    except Exception as e:
        err(e, 500)


@app.post("/api/export")
def export(req: ExportReq):
    try:
        content = svc.export_data(
            req.path, req.format, req.page, req.page_size,
            req.sort, req.columns, req.filters, req.query,
            req.sort_by, req.sort_dir,
        )
        ext = "xlsx" if req.format.lower() == "xlsx" else "csv"
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if req.format.lower() == "xlsx" else "text/csv"
        from fastapi.responses import Response
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="export.{ext}"'}
        )
    except ValueError as e:
        err(e, 400)
    except Exception as e:
        err(e, 500)


@app.post("/api/distinct")
def distinct(req: DistinctReq):
    try:
        cols = req.columns if req.columns else ([req.column] if req.column else None)
        return svc.distinct_values(
            req.path, cols, req.limit, req.filters, req.query,
        )
    except (FileNotFoundError, ValueError) as e:
        err(e, 400)
    except Exception as e:
        err(e, 500)


@app.post("/api/upload")
async def upload(f: UploadFile = File(...)):
    # Luu y: trinh duyet chi gui NOI DUNG file (khong cho web doc thang dia),
    # nen server phai luu ban copy vao uploads/ thi Polars moi scan duoc.
    if not f.filename.lower().endswith(".parquet"):
        raise HTTPException(400, "Chỉ chấp nhận file .parquet")
    session_dir = UPLOAD_DIR / f"session-{SESSION_ID}"
    session_dir.mkdir(parents=True, exist_ok=True)
    dest = session_dir / Path(f.filename).name
    with dest.open("wb") as out:
        shutil.copyfileobj(f.file, out)
    entry = svc.describe_file(dest, source="upload")
    entry["filename"] = dest.name
    return entry


@app.post("/api/add-path")
def add_path(req: AddPathReq):
    """Them 1 file vao danh sach theo duong dan (tham chieu thang file goc, KHONG copy)."""
    try:
        return svc.describe_file(req.path, source="disk")
    except FileNotFoundError as e:
        err(e, 404)
    except Exception as e:
        err(e)


@app.delete("/api/file")
def delete_file(path: str, from_disk: bool = False):
    """Ẩn khỏi danh sách (from_disk=false, client tự loại) hoặc xóa thật khỏi ổ đĩa."""
    try:
        if from_disk:
            p = Path(path).expanduser().resolve()
            if not p.exists():
                raise HTTPException(404, f"File không tồn tại: {path}")
            if p.suffix.lower() != ".parquet":
                raise HTTPException(400, "Chỉ được xóa file .parquet")
            p.unlink()
        return {"ok": True, "path": path, "from_disk": from_disk}
    except HTTPException:
        raise
    except Exception as e:
        err(e)


@app.get("/api/health")
def health():
    return {"ok": True, "version": app.version}


# ------------------------------------------------ native dialogs (Windows, server local)
# Trinh duyet khong bao gio lo duong dan that, nhung server dang chay NGAY
# TREN MAY user -> mo hop thoai native cua Windows de lay path that (khong copy).
# Dung tkinter (built-in) thay cho PowerShell: gon, khong can cai them, khong console.
def _tk_folder() -> str | None:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk(); root.withdraw()
    try:
        root.attributes("-topmost", True)
        p = filedialog.askdirectory(title="Chọn thư mục chứa file Parquet")
        return p or None
    finally:
        root.destroy()


def _tk_files() -> list[str]:
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk(); root.withdraw()
    try:
        root.attributes("-topmost", True)
        paths = filedialog.askopenfilenames(
            title="Chọn 1 hoặc nhiều file Parquet (lấy file gốc, không copy)",
            filetypes=[("Parquet files", "*.parquet"), ("All files", "*.*")],
        )
        return list(paths)
    finally:
        root.destroy()


def _run_in_main_thread(fn, timeout: float = 300) -> Any:
    """tkinter.dialog chi goi duoc tu main thread. FastAPI worker khong phai
    main thread -> chay ham vo trong 1 thread rieng, doi ket qua. Tranh dong
    bang UI neu user khong tuong tac."""
    if platform.system() == "Darwin":
        # Tkinter tren macOS bat buoc main thread (Cocoa) — chay tu worker thread
        # de crash/treo ca server. Tat tinh nang, huong user sang nut Upload.
        raise HTTPException(501, "Hộp thoại native chưa hỗ trợ trên macOS — hãy dùng nút Upload để thêm file (bản copy tạm, tự xóa khi tắt app).")
    box: dict = {}
    def runner():
        try: box["v"] = fn()
        except Exception as e: box["e"] = e
    t = threading.Thread(target=runner, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise HTTPException(408, "Hết giờ chờ hộp thoại (5 phút).")
    if "e" in box:
        raise HTTPException(500, f"Lỗi hộp thoại: {box['e']}")
    return box.get("v")


@app.get("/api/dialog/folder")
def dialog_folder():
    try:
        path = _run_in_main_thread(_tk_folder)  # goi 1 lan duy nhat
        if path is None:
            return {"cancelled": True}
        return {"cancelled": False, "path": path}
    except HTTPException:
        raise
    except Exception as e:
        err(e)


@app.get("/api/dialog/files")
def dialog_files():
    try:
        paths = _run_in_main_thread(_tk_files) or []  # goi 1 lan duy nhat
        if not paths:
            return {"cancelled": True}
        return {"cancelled": False, "paths": paths}
    except HTTPException:
        raise
    except Exception as e:
        err(e)


# ------------------------------------------------ frontend
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")


@app.get("/app", include_in_schema=False)
def app_index():
    index = STATIC_DIR / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return {"msg": "static/index.html chưa được build"}
