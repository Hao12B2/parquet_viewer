#!/usr/bin/env bash
# Parquet Viewer - chay nhu desktop app tren macOS (khong can giu Terminal)
#   Cach dung: mo Terminal, cd toi thu muc nay, chay:  ./run_app.sh
#   Tat han server: ./stop_server.sh
#   Xem log khi loi: mo file server.log
set -e
cd "$(dirname "$0")"
PORT=8000
URL="http://127.0.0.1:${PORT}/"

open_app() {
  if [ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]; then
    open -na "Google Chrome" --args --app="$URL"
  elif [ -x "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" ]; then
    open -na "Microsoft Edge" --args --app="$URL"
  else
    open "$URL"
  fi
}

if ! command -v python3 >/dev/null 2>&1; then
  echo "Chua co python3. Cai tu https://www.python.org/downloads/ roi chay lai."
  exit 1
fi

# Server dang chay roi thi chi mo cua so app
if curl -sf "$URL/api/health" >/dev/null 2>&1; then
  open_app
  exit 0
fi

python3 -m pip install -q -r requirements.txt
nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port "$PORT" > server.log 2>&1 &
echo $! > .server.pid

# Doi server san sang (toi da ~30 giay)
for _ in $(seq 1 30); do
  sleep 1
  if curl -sf "$URL/api/health" >/dev/null 2>&1; then
    open_app
    exit 0
  fi
done
echo "Khong khoi dong duoc server. Mo file server.log de xem loi chi tiet."
exit 1
