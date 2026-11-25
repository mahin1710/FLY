@echo off
title FLY Flight Booking Platform - Author: mahin1710
echo ========================================================
echo   Starting FLY Flight Booking Platform (Official Site)
echo   Author: mahin1710
echo   URL: http://localhost:5000
echo ========================================================
cd /d "%~dp0"

echo Opening default browser at http://localhost:5000 ...
start http://localhost:5000

echo Starting Python Flask Server on http://localhost:5000 ...
echo Press Ctrl+C to stop the server.
python app.py
pause
