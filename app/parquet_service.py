"""Core Parquet logic — 100% Polars LazyFrame, never read_parquet full file."""
from __future__ import annotations

import os
import time
from pathlib import Path
from typing import Any

import polars as pl
from io import BytesIO


# ---------------------------------------------------------------- helpers
def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} PB"


def resolve_parquet(path: str) -> Path:
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"Đường dẫn không tồn tại: {path}")
    if not p.is_file() or p.suffix.lower() != ".parquet":
        raise ValueError(f"Không phải file .parquet: {path}")
    return p


def scan(path: str) -> pl.LazyFrame:
    return pl.scan_parquet(resolve_parquet(path))


# ---------------------------------------------------------------- browse
def describe_file(path: str | Path, source: str = "disk") -> dict:
    """Mo ta 1 file parquet de hien trong danh sach. source: 'disk' | 'upload'."""
    p = Path(path).expanduser().resolve()
    if not p.exists():
        raise FileNotFoundError(f"Đường dẫn không tồn tại: {path}")
    if not p.is_file() or p.suffix.lower() != ".parquet":
        raise ValueError(f"Không phải file .parquet: {path}")
    st = p.stat()
    # num_rows tu parquet metadata (re, khong scan full data) - can cho estimate memory truoc khi join
    try:
        num_rows = pl.scan_parquet(p).select(pl.len()).collect().item()
    except Exception:
        num_rows = 0
    return {
        "name": p.name,
        "path": str(p),
        "size": st.st_size,
        "size_human": human_size(st.st_size),
        "mtime": st.st_mtime,
        "mtime_human": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
        "source": source,
        "num_rows": num_rows,
    }


def list_parquet_files(directory: str, recursive: bool = True) -> list[dict]:
    base = Path(directory).expanduser().resolve()
    if not base.exists() or not base.is_dir():
        raise NotADirectoryError(f"Thư mục không tồn tại: {directory}")
    pattern = "**/*.parquet" if recursive else "*.parquet"
    out = []
    for p in sorted(base.glob(pattern)):
        try:
            entry = describe_file(p, source="disk")
            entry["relative"] = str(p.relative_to(base))
            out.append(entry)
        except OSError:
            continue
    return out


# ---------------------------------------------------------------- schema / stats
def get_schema_info(path: str) -> dict:
    p = resolve_parquet(path)
    lf = pl.scan_parquet(p)
    schema = lf.collect_schema()
    columns = [{"name": n, "dtype": str(t)} for n, t in schema.items()]
    num_rows = lf.select(pl.len()).collect().item()
    return {
        "path": str(p),
        "file_size": p.stat().st_size,
        "file_size_human": human_size(p.stat().st_size),
        "num_rows": num_rows,
        "num_cols": len(columns),
        "columns": columns,
    }


# ---------------------------------------------------------------- filters
_OPS = {
    "=", "==", "!=", ">", "<", ">=", "<=",
    "between", "contains", "not_contains",
    "starts_with", "not_starts_with", "ends_with", "not_ends_with",
    "regex", "not_regex", "is_null", "is_not_null", "in", "not_in",
    "slice_eq", "slice_contains", "strip_eq", "strip_contains",
}

def _coerce_value(dtype: pl.DataType, value: Any) -> Any:
    """Best-effort coerce filter value to column dtype."""
    if value is None:
        return None
    s = str(dtype)
    try:
        if "Int" in s or "UInt" in s:
            return int(float(value))
        if "Float" in s:
            return float(value)
        if "Boolean" in s:
            if isinstance(value, bool):
                return value
            return str(value).lower() in ("1", "true", "yes", "y")
        # Utf8 / Datetime / Date: keep string, Polars will parse on compare
        return value
    except (ValueError, TypeError):
        return value


def build_expr(dtype_map: dict[str, pl.DataType], f: dict) -> pl.Expr:
    col_name = f.get("column")
    op = f.get("op")
    if col_name not in dtype_map:
        raise ValueError(f"Cột không tồn tại: {col_name}")
    if op not in _OPS:
        raise ValueError(f"Phép toán không hỗ trợ: {op}")
    c = pl.col(col_name)
    dtype = dtype_map[col_name]
    v = f.get("value")
    v2 = f.get("value2")

    if op == "is_null":
        return c.is_null()
    if op == "is_not_null":
        return c.is_not_null()
    if op == "between":
        if v is None or v2 is None:
            raise ValueError("between cần value và value2")
        return c.is_between(_coerce_value(dtype, v), _coerce_value(dtype, v2))
    if op in ("in", "not_in"):
        if v is None or str(v).strip() == "":
            raise ValueError("in / not_in cần tập giá trị, vd: VNM, VCB, HPG")
        items = [x.strip() for x in str(v).replace(";", ",").split(",")]
        items = [x for x in items if x != ""]
        if not items:
            raise ValueError("in / not_in cần ít nhất 1 giá trị")
        vals = [_coerce_value(dtype, x) for x in items]
        expr = c.is_in(vals)
        return expr if op == "in" else ~expr
    if op == "contains":
        if v is None or str(v) == "":
            raise ValueError("contains cần giá trị, vd: VN")
        return c.cast(pl.String).str.contains(str(v), literal=True)
    if op == "not_contains":
        if v is None or str(v) == "":
            raise ValueError("not_contains cần giá trị, vd: VN")
        return ~c.cast(pl.String).str.contains(str(v), literal=True)
    if op == "starts_with":
        if v is None or str(v) == "":
            raise ValueError("starts_with cần giá trị, vd: VN")
        return c.cast(pl.String).str.starts_with(str(v))
    if op == "not_starts_with":
        if v is None or str(v) == "":
            raise ValueError("not_starts_with cần giá trị, vd: VN")
        return ~c.cast(pl.String).str.starts_with(str(v))
    if op == "ends_with":
        if v is None or str(v) == "":
            raise ValueError("ends_with cần giá trị, vd: HN")
        return c.cast(pl.String).str.ends_with(str(v))
    if op == "not_ends_with":
        if v is None or str(v) == "":
            raise ValueError("not_ends_with cần giá trị, vd: HN")
        return ~c.cast(pl.String).str.ends_with(str(v))
    if op == "regex":
        if v is None or str(v) == "":
            raise ValueError("regex cần pattern, vd: ^VN\\d+$")
        return c.cast(pl.String).str.contains(str(v), literal=False)
    if op == "not_regex":
        if v is None or str(v) == "":
            raise ValueError("not_regex cần pattern, vd: ^VN\\d+$")
        return ~c.cast(pl.String).str.contains(str(v), literal=False)
    if op in ("slice_eq", "slice_contains"):
        # value = "offset,length" (vd "3,1" = ký tự thứ 4, lấy 1 ký tự; offset tính từ 0).
        # value2 = chuỗi mong đợi (slice_eq: bằng; slice_contains: chứa).
        if v is None or str(v).strip() == "":
            raise ValueError("slice cần value dạng 'offset,length', vd: '3,1' (ký tự thứ 4, lấy 1 ký tự)")
        if v2 is None:
            raise ValueError("slice cần value2 là chuỗi mong đợi, vd: X")
        parts = [p.strip() for p in str(v).split(",")]
        try:
            offset = int(parts[0])
        except (ValueError, IndexError):
            raise ValueError("slice: offset phải là số nguyên, vd: '3,1'") from None
        length = None
        if len(parts) > 1 and parts[1] != "":
            try:
                length = int(parts[1])
            except ValueError:
                raise ValueError("slice: length phải là số nguyên, vd: '3,1'") from None
        sliced = c.cast(pl.String).str.slice(offset, length)
        if op == "slice_eq":
            return sliced == str(v2)
        return sliced.str.contains(str(v2), literal=True)
    if op in ("strip_eq", "strip_contains"):
        # value = ký tự cần strip (để trống = khoảng trắng); value2 = chuỗi mong đợi sau khi strip.
        if v2 is None:
            raise ValueError("strip cần value2 là chuỗi mong đợi sau khi strip, vd: ABC")
        chars = None if v is None or str(v) == "" else str(v)
        stripped = c.cast(pl.String).str.strip_chars(chars)
        if op == "strip_eq":
            return stripped == str(v2)
        return stripped.str.contains(str(v2), literal=True)
    cv = _coerce_value(dtype, v)
    if op in ("=", "=="):
        return c == cv
    if op == "!=":
        return c != cv
    if op == ">":
        return c > cv
    if op == "<":
        return c < cv
    if op == ">=":
        return c >= cv
    if op == "<=":
        return c <= cv
    raise ValueError(f"Op chưa xử lý: {op}")


def combine_filters(exprs: list[pl.Expr], logics: list[str]) -> pl.Expr | None:
    if not exprs:
        return None
    acc = exprs[0]
    for e, logic in zip(exprs[1:], logics):
        acc = (acc | e) if (logic or "AND").upper() == "OR" else (acc & e)
    return acc


def eval_custom_query(query: str) -> pl.Expr:
    """Validate & parse custom Polars expression safely."""
    q = (query or "").strip()
    if not q:
        raise ValueError("Biểu thức rỗng")
    forbidden = ["__", "import", "open", "exec", "eval", "os.", "sys.", "subprocess", "pathlib"]
    for w in forbidden:
        if w in q:
            raise ValueError(f"Biểu thức chứa từ khóa cấm: {w}")
    safe_globals = {"__builtins__": {}, "pl": pl, "col": pl.col, "lit": pl.lit}
    try:
        expr = eval(q, safe_globals, {})  # noqa: S307 — sandboxed globals
    except Exception as e:
        raise ValueError(f"Biểu thức Polars không hợp lệ: {e}") from e
    if not isinstance(expr, pl.Expr):
        raise ValueError("Biểu thức phải trả về pl.Expr, ví dụ: pl.col(\"a\") > 1")
    return expr


def apply_filters(lf: pl.LazyFrame, filters: list[dict] | None, query: str | None) -> pl.LazyFrame:
    dtype_map = dict(lf.collect_schema().items())
    exprs, logics = [], []
    for f in filters or []:
        exprs.append(build_expr(dtype_map, f))
        logics.append(f.get("logic", "AND"))
    if exprs:
        lf = lf.filter(combine_filters(exprs, logics[1:] if len(logics) > 1 else []))
    if query and query.strip():
        lf = lf.filter(eval_custom_query(query))
    # refresh dtype map after filter is unnecessary; filter doesn't change schema
    return lf


# ---------------------------------------------------------------- paginated data
def query_data(
    path: str,
    page: int = 1,
    page_size: int = 100,
    sort_by: str | None = None,
    sort_dir: str = "asc",
    columns: list[str] | None = None,
    filters: list[dict] | None = None,
    query: str | None = None,
    sort: list[dict] | None = None,
) -> dict:
    p = resolve_parquet(path)
    page = max(1, int(page))
    page_size = min(2000, max(1, int(page_size)))
    lf = pl.scan_parquet(p)
    schema = lf.collect_schema()
    all_cols = list(schema.keys())

    if columns is not None:  # [] = không cột nào (khác null = tất cả)
        unknown = [c for c in columns if c not in schema]
        if unknown:
            raise ValueError(f"Cột không tồn tại: {unknown}")
        lf = lf.select(columns)

    lf = apply_filters(lf, filters, query)

    total_rows = lf.select(pl.len()).collect().item()

    # Multi-sort: sort=[{column, dir}, ...] uu tien hon sort_by legacy.
    # Cot dau tien = khoa chinh, cac cot sau = khoa phu (giong ORDER BY a, b).
    order: list[tuple[str, str]] = []
    if sort:
        for s in sort:
            c = s.get("column") if isinstance(s, dict) else None
            d = s.get("dir", "asc") if isinstance(s, dict) else "asc"
            if not c:
                raise ValueError("Sort thiếu tên cột")
            if d not in ("asc", "desc"):
                raise ValueError(f"Hướng sort không hợp lệ: {d}")
            order.append((c, d))
    elif sort_by:
        order = [(sort_by, sort_dir if sort_dir in ("asc", "desc") else "asc")]

    if order:
        schema_now = lf.collect_schema()
        for c, _ in order:
            if c not in schema_now:
                raise ValueError(f"Cột sort không tồn tại: {c}")
        lf = lf.sort([c for c, _ in order],
                     descending=[d == "desc" for _, d in order])

    offset = (page - 1) * page_size
    # KEY PERF: slice on LazyFrame then collect only the page
    df = lf.slice(offset, page_size).collect()

    # Serialize: everything to python natives, stringify exotic types
    rows = df.to_dicts()
    dtypes = {n: str(t) for n, t in df.schema.items()}
    total_pages = (total_rows + page_size - 1) // page_size if total_rows else 0
    return {
        "path": str(p),
        "page": page,
        "page_size": page_size,
        "total_rows": total_rows,
        "total_pages": total_pages,
        "columns": df.columns,
        "dtypes": dtypes,
        "all_columns": all_cols,
        "rows": rows,
    }


# ---------------------------------------------------------------- compare
def compare_schemas(path_a: str, path_b: str) -> dict:
    ia, ib = get_schema_info(path_a), get_schema_info(path_b)
    da = {c["name"]: c["dtype"] for c in ia["columns"]}
    db = {c["name"]: c["dtype"] for c in ib["columns"]}
    only_a = [c for c in da if c not in db]
    only_b = [c for c in db if c not in da]
    mismatch = [
        {"column": c, "dtype_a": da[c], "dtype_b": db[c]}
        for c in da if c in db and da[c] != db[c]
    ]
    return {
        "file_a": {
            "path": ia["path"], "num_rows": ia["num_rows"], "num_cols": ia["num_cols"],
            "file_size_human": ia.get("file_size_human", "?"),
        },
        "file_b": {
            "path": ib["path"], "num_rows": ib["num_rows"], "num_cols": ib["num_cols"],
            "file_size_human": ib.get("file_size_human", "?"),
        },
        "only_in_a": only_a,
        "only_in_b": only_b,
        "dtype_mismatch": mismatch,
        "common_columns": [c for c in da if c in db],
    }


# ------- Compare-data: don gian va nhanh
# Cach lam: chi select keys + non_key_cols (user chon), sau do:
#   1. 2 anti-join (only_a/only_b) - re, chi so sanh keys
#   2. 1 inner join (matched) + filter cot khac gia tri
# Dung streaming engine cho count/slice de tranh OOM.
# Giu MAX_COMPARE_BYTES thap de truoc khi server chay inner join lon:
# inner join 2 file 1GB co the phinh 2-3GB RAM ngay ca khi streaming.
MAX_COMPARE_BYTES = 1 * 1024 * 1024 * 1024  # 1GB tong 2 file
MAX_DIFF_ROWS = 100_000


def compare_data(
    path_a: str,
    path_b: str,
    keys: list[str],
    page: int = 1,
    page_size: int = 100,
    diff_only: bool = True,
    compare_columns: list[str] | None = None,
    coalesce_null_keys: bool = False,
) -> dict:
    if not keys:
        raise ValueError("Cần chọn ít nhất 1 cột làm Primary Key")
    pa, pb = resolve_parquet(path_a), resolve_parquet(path_b)
    size_a, size_b = pa.stat().st_size, pb.stat().st_size
    if size_a + size_b > MAX_COMPARE_BYTES:
        raise ValueError(
            f"Hai file quá lớn ({human_size(size_a)} + {human_size(size_b)} = "
            f"{human_size(size_a+size_b)}, giới hạn {human_size(MAX_COMPARE_BYTES)})."
        )
    la, lb = pl.scan_parquet(pa), pl.scan_parquet(pb)
    sa, sb = set(la.collect_schema()), set(lb.collect_schema())
    for k in keys:
        if k not in sa:
            raise ValueError(f"Key '{k}' không có trong file A")
        if k not in sb:
            raise ValueError(f"Key '{k}' không có trong file B")
    common = sorted(sa & sb)
    # User chi dinh cot so sanh: chi dung dung cot do. Nguoc lai: auto lay common - key.
    if compare_columns:
        unknown = [c for c in compare_columns if c not in common]
        if unknown:
            raise ValueError(f"Cột so sánh không tồn tại ở cả 2 file: {unknown}")
        non_key_common = [c for c in compare_columns if c not in keys]
    else:
        non_key_common = [c for c in common if c not in keys]

    # Safety: inner join (key + non_key x 2) voi nhieu cot so sanh + file lon = OOM.
    # Uoc luong so dong matched <= min(num_rows_a, num_rows_b), moi dong ~ (nKeys + 2*nCompare) x 16 bytes.
    nRows_a = la.select(pl.len()).collect().item()
    nRows_b = lb.select(pl.len()).collect().item()
    estMatched = min(nRows_a, nRows_b)
    estBytes = estMatched * (len(keys) + 2 * len(non_key_common)) * 16
    if estBytes > 1 * 1024**3:
        estGB = estBytes / 1024**3
        raise ValueError(
            f"Quá nhiều cột so sánh so với kích thước file — ước lượng {estGB:.1f} GB RAM.\n"
            f"  • Matched: {estMatched:,} dòng\n  • Cột so sánh: {len(non_key_common)} ({', '.join(non_key_common)})\n"
            f"Hãy BỎ CHỌN bớt cột ở mục 'Cột so sánh' (chỉ giữ 1-2 cột cần xem diff)."
        )

    # 1) Chi select keys + non_key_cols (re, dung cot da chon)
    a_cols = keys + non_key_common
    a = la.select(a_cols)
    b = lb.select(a_cols)

    # 2) Neu coalesce NULL PK: tao cot _coalesced de join (NULL -> "__NULL_PK__")
    coalesced_keys = []
    if coalesce_null_keys:
        coalesced_keys = list(keys)
        for k_orig in coalesced_keys:
            coal = f"__{k_orig}_coalesced"
            a = a.with_columns(
                pl.when(pl.col(k_orig).is_null()).then(pl.lit("__NULL_PK__")).otherwise(pl.col(k_orig).cast(pl.Utf8)).alias(coal)
            )
            b = b.with_columns(
                pl.when(pl.col(k_orig).is_null()).then(pl.lit("__NULL_PK__")).otherwise(pl.col(k_orig).cast(pl.Utf8)).alias(coal)
            )
        keys = [f"__{k}_coalesced" for k in coalesced_keys]

    # 3) Anti-join (re, chi so keys): only_a / only_b
    only_a_q = a.join(b.select(keys), on=keys, how="anti")
    only_b_q = b.join(a.select(keys), on=keys, how="anti")

    # 4) Inner-join + filter: matched co gia tri khac
    matched = None
    if non_key_common:
        matched = a.join(b, on=keys, how="inner", suffix="_b")
        if diff_only:
            diff_cond = pl.lit(False)
            for c in non_key_common:
                diff_cond = diff_cond | (
                    (pl.col(c) != pl.col(f"{c}_b")) &
                    ~(pl.col(c).is_null() & pl.col(f"{c}_b").is_null())
                )
            matched = matched.filter(diff_cond)

    # 5) Counts (lazy chi dem, khong materialize data).
    # Dung streaming engine de khong OOM khi count: polars se doc tung chunk thay vi load full frame.
    n_only_a = only_a_q.select(pl.len()).collect().item()
    n_only_b = only_b_q.select(pl.len()).collect().item()
    n_matched = matched.select(pl.len()).collect().item() if matched is not None else 0
    total = n_matched + n_only_a + n_only_b
    capped = total > MAX_DIFF_ROWS
    if capped and matched is not None:
        matched = matched.head(MAX_DIFF_ROWS)
        n_matched = min(n_matched, MAX_DIFF_ROWS)

    # 6) Pagination: order = [only_a, only_b, matched]
    offset = (page - 1) * page_size
    page = max(1, int(page))
    rows = []
    remaining = page_size

    # Part 1: only_a
    if offset < n_only_a and remaining > 0:
        take = min(remaining, n_only_a - offset)
        df = only_a_q.slice(offset, take).collect(engine="streaming")
        if coalesce_null_keys:
            df = df.drop([f"__{k}_coalesced" for k in coalesced_keys])
        for c in non_key_common:
            df = df.with_columns(pl.lit(None).alias(f"{c}_b"))
        for r in df.to_dicts():
            r["_status"] = "only_in_a"
            r["_cell_diff"] = {}
            rows.append(r)
        remaining -= take
        offset = 0
    else:
        offset = max(0, offset - n_only_a)

    # Part 2: only_b
    if remaining > 0 and offset < n_only_b:
        take = min(remaining, n_only_b - offset)
        df = only_b_q.slice(offset, take).collect(engine="streaming")
        if coalesce_null_keys:
            df = df.drop([f"__{k}_coalesced" for k in coalesced_keys])
        dicts = df.to_dicts()
        for r in dicts:
            display = {}
            if coalesce_null_keys:
                # Hien gia tri GOC (None van la None), khong hien sentinel "__NULL_PK__"
                for k_orig in coalesced_keys:
                    display[k_orig] = r.get(k_orig)
            else:
                for k in keys:
                    display[k] = r.get(k)
            for c in non_key_common:
                display[c] = None  # A side null
                display[f"{c}_b"] = r[c]  # B side
            display["_status"] = "only_in_b"
            display["_cell_diff"] = {}
            rows.append(display)
        remaining -= take
        offset = 0
    else:
        offset = max(0, offset - n_only_b)

    # Part 3: matched rows (modified; hoac same khi diff_only=False)
    if remaining > 0 and offset < n_matched and matched is not None:
        take = min(remaining, n_matched - offset)
        df = matched.slice(offset, take).collect(engine="streaming")
        if coalesce_null_keys:
            # Drop cot join noi bo + cot goc-ben-B trung lap (id_b), giu cot goc ben-A de hien thi
            df = df.drop(
                [f"__{k}_coalesced" for k in coalesced_keys]
                + [f"{k}_b" for k in coalesced_keys if f"{k}_b" in df.columns]
            )
        for r in df.to_dicts():
            cell_diff = {}
            for c in non_key_common:
                va, vb = r.get(c), r.get(f"{c}_b")
                cell_diff[c] = (va != vb) and not (va is None and vb is None)
            # diff_only=True -> matched da loc nen tat ca la modified.
            # diff_only=False -> co ca dong giong het, danh dau same cho dung.
            r["_status"] = "modified" if any(cell_diff.values()) else "same"
            r["_cell_diff"] = cell_diff
            rows.append(r)

    # Display labels: doi ten cot coalesced ve ten goc de UI khong hien "__xxx_coalesced"
    display_keys = coalesced_keys if coalesce_null_keys else list(keys)
    # total_pages tinh tren so dong THUC TE tra ve (capped) de khong co trang rong
    visible_total = min(total, MAX_DIFF_ROWS) if capped else total
    visible_pages = (visible_total + page_size - 1) // page_size if visible_total else 0
    return {
        "keys": display_keys,
        "common_columns": common,
        "non_key_common": non_key_common,
        "left_columns": display_keys + non_key_common,
        "right_columns": [f"{c}_b" for c in non_key_common],
        "page": page,
        "page_size": page_size,
        "total_rows": total,
        "total_pages": visible_pages,
        "capped": capped,
        "cap_limit": MAX_DIFF_ROWS if capped else None,
        "n_matched_diff": n_matched,
        "n_only_in_a": n_only_a,
        "n_only_in_b": n_only_b,
        "rows": rows,
    }


# ---------------------------------------------------------------- export
def export_data(
    path: str,
    format: str = "xlsx",
    page: int = 1,
    page_size: int = 0,
    sort: list[dict] | None = None,
    columns: list[str] | None = None,
    filters: list[dict] | None = None,
    query: str | None = None,
    sort_by: str | None = None,
    sort_dir: str = "asc",
) -> bytes:
    """
    Xuất dữ liệu ra file (Excel/CSV). page_size = 0 nghĩa là xuất tất cả.
    """
    p = resolve_parquet(path)
    lf = pl.scan_parquet(p)

    if columns is not None:  # [] = không cột nào (khác null = tất cả)
        unknown = [c for c in columns if c not in lf.collect_schema()]
        if unknown:
            raise ValueError(f"Cột không tồn tại: {unknown}")
        lf = lf.select(columns)

    lf = apply_filters(lf, filters, query)

    if sort:
        order = []
        for s in sort:
            c = s.get("column")
            d = s.get("dir", "asc")
            if not c or d not in ("asc", "desc"):
                raise ValueError(f"Sort không hợp lệ: {s}")
            order.append((c, d))
        if order:
            lf = lf.sort([c for c, _ in order], descending=[d == "desc" for _, d in order])
    elif sort_by:
        lf = lf.sort(sort_by, descending=(sort_dir == "desc"))

    if page_size > 0:
        offset = (max(1, page) - 1) * page_size
        lf = lf.slice(offset, page_size)

    df = lf.collect()

    buf = BytesIO()
    if format.lower() == "xlsx":
        df.write_excel(buf)
    elif format.lower() == "csv":
        df.write_csv(buf)
    else:
        raise ValueError(f"Định dạng không hỗ trợ: {format}. Chỉ hỗ trợ xlsx, csv")
    return buf.getvalue()


# ---------------------------------------------------------------- distinct
def distinct_values(
    path: str,
    columns: str | list[str],
    limit: int = 1000,
    filters: list[dict] | None = None,
    query: str | None = None,
) -> dict:
    """Liệt kê các tổ hợp distinct của 1 hoặc nhiều cột kèm tần suất, sắp xếp theo count giảm dần."""
    if isinstance(columns, str):
        columns = [columns]
    columns = [c for c in (columns or []) if c]
    if not columns:
        raise ValueError("Chưa chọn cột để xem distinct")
    p = resolve_parquet(path)
    lf = pl.scan_parquet(p)
    schema = lf.collect_schema()
    unknown = [c for c in columns if c not in schema]
    if unknown:
        raise ValueError(f"Cột không tồn tại: {unknown}")
    limit = min(10000, max(1, int(limit or 1000)))

    lf = apply_filters(lf, filters, query)

    total_distinct = lf.select(pl.struct(columns).n_unique()).collect().item()
    df = (
        lf.select(columns)
        .group_by(columns, maintain_order=False)
        .len()
        .sort("len", descending=True)
        .slice(0, limit)
        .collect()
    )
    rows = [{**{c: r[c] for c in columns}, "count": r["len"]} for r in df.to_dicts()]
    return {
        "path": str(p),
        "columns": columns,
        "column": columns[0],
        "dtypes": {c: str(schema[c]) for c in columns},
        "total_distinct": total_distinct,
        "limit": limit,
        "truncated": total_distinct > limit,
        "rows": rows,
    }
