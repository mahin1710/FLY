@echo off
title FLY Flight Booking System - Author: mahin1710
echo ========================================================
echo   Starting FLY Flight Booking System (Web Edition)
echo   Author: mahin1710
echo ========================================================
cd /d "%~dp0Skynet-master\Skynet-master\web"
echo Running server on http://localhost:5000 ...
echo Press Ctrl+C to stop.
node server.js
pause
