@echo off
title Netlify Deployment - FLY
echo ========================================================
echo   FLY Flight Booking - Netlify Deployment Helper
echo   Author: mahin1710
echo ========================================================
echo.
echo Step 1: Logging into Netlify...
echo (Your browser will open. Please click 'Authorize')
echo.
call npx -y netlify-cli login
echo.
echo Step 2: Deploying to Netlify Production...
call npx -y netlify-cli deploy --prod
echo.
echo ========================================================
echo   Deployment Complete!
echo ========================================================
pause
