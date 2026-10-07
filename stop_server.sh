#!/usr/bin/env bash
# Tat han server Parquet Viewer + don file upload tam theo phien (chi xoa session-*)
cd "$(dirname "$0")"
echo "Dang tat Parquet Viewer ..."
if [ -f .server.pid ]; then
  PID=$(cat .server.pid)
  if kill "$PID" 2>/dev/null; then
    echo " - Tat tien trinh PID $PID"
  fi
  rm -f .server.pid
fi
# Phong truong hop con tien trinh treo cong 8000
LEFT=$(lsof -ti:8000 2>/dev/null || true)
if [ -n "$LEFT" ]; then
  echo "$LEFT" | xargs kill 2>/dev/null && echo " - Don tien trinh treo cong 8000"
fi
# Don sach file upload tam theo phien (khong dung file user tu de)
if [ -d "app/uploads" ]; then
  for d in app/uploads/session-*; do
    [ -d "$d" ] && rm -rf "$d" && echo " - Xoa thu muc tam $(basename "$d")"
  done
fi
echo "Xong."
