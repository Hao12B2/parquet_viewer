@echo off
REM Tat han server Parquet Viewer dang chay nen (cong 8000)
echo Dang tat Parquet Viewer ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr LISTENING ^| findstr /C:":8000 "') do (
  echo  - Tat tien trinh PID %%a
  taskkill /F /PID %%a >nul 2>nul
)
REM Don sach file upload tam theo phien (chi xoa session-*, khong dung file user tu de)
if exist "%~dp0app\uploads" (
  for /d %%d in ("%~dp0app\uploads\session-*") do (
    echo  - Xoa thu muc tam %%~nxd
    rmdir /s /q "%%d" >nul 2>nul
  )
)
echo Xong.
pause
