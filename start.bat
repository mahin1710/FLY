@echo off
title FLY Flight Booking System - Python Flask Edition (Author: mahin1710)
echo ========================================================
echo   Starting FLY Flight Booking System (Python Flask Edition)
echo   Author: mahin1710
echo ========================================================
cd /d "%~dp0"
echo Starting Python Flask Server on http://localhost:5000 ...
echo Press Ctrl+C to stop.
python app.py
pause
