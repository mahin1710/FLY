================================================================================
          SKYNET FLIGHT BOOKING SYSTEM (BANGLADESH EDITION)
                 PROJECT DOCUMENTATION & MASTER GUIDE
================================================================================
Author: mahin1710
Maintained by: mahin1710
Last Updated: 2026-11-17
Platform: Web Edition (Node.js + SQLite + HTML5/CSS3/JS) & Java Desktop Edition

--------------------------------------------------------------------------------
TABLE OF CONTENTS
--------------------------------------------------------------------------------
1. QUICK START (HOW TO RUN LOCALLY)
2. LIVE CREDENTIALS & DEMO ACCOUNTS
3. CAN THIS PROJECT BE RUN IN PYTHON / HTML / CSS / JS / JAVA WITHOUT CHANGES?
4. SIMPLIFIED FOLDER STRUCTURE EXPLANATION
5. RECENT MAJOR CHANGES (WHAT HAS BEEN DONE)
6. MASTER TO-DO & FUTURE CHANGES CHECKLIST (UPDATE TRACKER)

================================================================================
1. QUICK START (HOW TO RUN LOCALLY)
================================================================================
You have two simple ways to run the project on your localhost:

METHOD A (EASIEST - 1-CLICK):
  -> Double-click the "start.bat" file located in this root directory.
  -> It will open a terminal and automatically start the server on Port 5000.

METHOD B (USING TERMINAL / POWERSHELL):
  -> Open PowerShell or Command Prompt in this folder.
  -> Run:
       npm.cmd start
     OR:
       cd Skynet-master\web
       node server.js

AFTER STARTING:
  -> Open your web browser (Chrome, Edge, Firefox, Brave).
  -> Visit: http://localhost:5000
  -> Direct Log In / Log Out Page: http://localhost:5000/#login

================================================================================
2. LIVE CREDENTIALS & DEMO ACCOUNTS
================================================================================
The database contains pre-configured test accounts ready for instant 1-click login:

[A] BANGLADESHI PASSENGER (TRAVELER):
    Username: Mahin0
    Password: Mahin0
    Display Name: MMH_Mahin
    Location: Dhaka, Bangladesh
    Role: PASSENGER
    Features: Book flights, select seats, conflict-free 15-min hold, view boarding pass, manage saved trips.

[B] BIMAN BANGLADESH AIRLINES (NATIONAL CARRIER ADMIN):
    Username: Admin_Biman
    Password: Admin_Biman
    Role: AIRLINE_ADMIN (Biman Bangladesh Airlines)
    Features: Fleet schedule manager, ticket sales, gross revenue analytics, booking statistics.

[C] US-BANGLA AIRLINES (TOP PRIVATE AIRLINE ADMIN):
    Username: Admin_USB
    Password: Admin_USB
    Role: AIRLINE_ADMIN (US-Bangla Airlines)
    Features: Domestic & international flight schedule manager, booking statistics, sales monitoring.

[D] ALTERNATIVE PASSENGER:
    Username: Mahin1
    Password: Mahin1
    Role: PASSENGER
    Location: Chittagong, Bangladesh
    Features: Search flights, select seats, conflict-free booking tests.

================================================================================
3. CAN THIS PROJECT BE RUN IN PYTHON, CSS, HTML, JAVA OR JS WITHOUT CHANGES?
================================================================================
QUESTION:
"Full project ta ki ami python, css, html, java or js use kore kora jabe kono change na kore?"

EXPLANATION & ANSWER:

1. CURRENT RUNNING SETUP (HTML + CSS + JS + Node.js + SQLite):
   -> This is what runs right now with ZERO changes needed!
   -> Frontend: HTML5 (structure), CSS3 (styling, dark/light theme), Vanilla JS (app logic).
   -> Backend: Node.js (v20+) with native SQLite.
   -> All browser interactions (seat maps, ticket booking, login, currency in Taka)
      run directly out-of-the-box.

2. JAVA:
   -> The ORIGINAL repository in folder "Skynet-master/Skynet-master/Skynet-master"
      was written in JAVA (JavaFX + Maven + SQLite).
   -> It is a DESKTOP application (a native Windows window).
   -> If you want to run the Java version, you need Java JDK 17+ and Maven:
        mvn clean javafx:run
   -> Notice: JavaFX desktop cannot directly render HTML/CSS web pages without WebView,
      so the Java version is for desktop, while the "web" folder is for browser web app.

3. PYTHON (CAN WE USE PYTHON INSTEAD OF NODE.JS WITHOUT CHANGING FRONTEND?):
   -> YES, ABSOLUTELY!
   -> Because the web frontend (HTML/CSS/JS) is fully decoupled and only communicates
      via standard REST APIs (/api/flights, /api/auth/login, /api/airports, etc.).
   -> If you write a Python backend (using Flask or FastAPI) connected to the same
      "database.db" (SQLite) that exposes those exact API URLs:
      * YOU DO NOT NEED TO CHANGE A SINGLE LINE OF HTML, CSS, OR JS IN THE FRONTEND!
      * The frontend will connect to Python just as easily as it connects to Node.js.

================================================================================
4. SIMPLIFIED FOLDER STRUCTURE EXPLANATION
================================================================================
Due to zip extraction from GitHub, you might see nested "Skynet-master" folders.
Here is what each folder actually is:

c:\Users\mahed\Downloads\Skynet-master\  <-- [MAIN ROOT DIRECTORY]
│
├── start.bat                  <-- 1-Click launcher (starts the web server)
├── package.json               <-- Root script configuration (npm start)
├── README.txt                 <-- This master guide and update tracker
│
└── Skynet-master\
    │
    ├── web\                   <-- ★★★ THE ACTIVE WEB APPLICATION ★★★
    │   ├── server.js          <-- Node.js Express backend & API endpoints
    │   ├── database.db        <-- SQLite Database (Airports, Flights, Users, Seats)
    │   ├── package.json       <-- Web dependencies (express, cors)
    │   ├── update_dates.js    <-- Database helper (flight timelines)
    │   │
    │   └── public\            <-- FRONTEND (HTML / CSS / JAVASCRIPT)
    │       ├── index.html     <-- Single-Page Application (SPA) Web UI
    │       ├── css\style.css  <-- Dark/Light theme, glassmorphic styling
    │       ├── js\app.js      <-- Interactive seat map, search, auth logic
    │       └── images\        <-- Logos (Skynet, Biman, Profile avatars)
    │
    └── Skynet-master\         <-- [ORIGINAL JAVA DESKTOP APPLICATION]
        ├── pom.xml            <-- Maven configuration for Java
        ├── build_app_windows.bat <-- Packaging batch script for Java
        ├── src\               <-- Java & JavaFX MVC source code
        └── imgs\              <-- Screenshots of the original Java GUI

================================================================================
5. RECENT MAJOR CHANGES (WHAT HAS BEEN DONE)
================================================================================
[X] 1. LOCALHOST DEPLOYMENT:
       - Configured Node.js and SQLite to run seamlessly on http://localhost:5000.
       - Added root start.bat and root package.json for 1-click execution.

[X] 2. DEDICATED LOG IN & LOG OUT PAGE:
       - Built a dedicated page view (#login / #logout) in addition to quick modals.
       - Integrated navigation button: displays "Sign In" when logged out, and
         "Log Out" with user session badge when logged in.
       - Active User Session card with profile picture, role badge, quick links to
         trips, and a prominent red "Log Out of Skynet" button.

[X] 3. BANGLADESH PERSPECTIVE (PRIORITIZED AT TOP):
       - Default Search Origin: Pre-filled with Hazrat Shahjalal Intl Airport, Dhaka (DAC).
       - Hero section branded: "Skynet Bangladesh - Bangladesh's Premier Flight Network".
       - Quick Bangladesh Route buttons: Dhaka to Cox's Bazar, Chittagong, Sylhet,
         Dubai, London, Singapore.
       - Airport Autocomplete: Bangladesh airports (Dhaka DAC, Chittagong CGP,
         Cox's Bazar CXB, Sylhet ZYL, Saidpur SPD, etc.) display at the top of results.
       - Database: Inserted 18 active scheduled flights for Biman Bangladesh Airlines,
         US-Bangla Airlines, and Novoair for upcoming 2026 dates.

[X] 4. CURRENCY IN BANGLADESHI TAKA (৳ / BDT):
       - Replaced all dollar ($) displays with Bangladeshi Taka (৳).
       - Added global currency formatter: formatCurrency() formatting numbers in
         standard South Asian / Bangladeshi comma format (e.g. ৳3,800, ৳48,500).
       - Converted seat prices, luggage fees, weight charges, checkout totals,
         boarding pass rates, and airline revenue metrics into BDT (৳).

[X] 5. BANGLADESHI TEST ACCOUNTS:
       - Biman Bangladesh Airlines: admin_BG / admin_BG
       - US-Bangla Airlines: admin_BS / admin_BS
       - Bangladeshi Passenger: rahim_bd / rahim123

================================================================================
6. MASTER TO-DO & FUTURE CHANGES CHECKLIST (UPDATE TRACKER)
================================================================================
You can edit and check off items in this section as your project evolves:

[ ] FEATURE: Add bKash / Nagad / Rocket Bangladeshi mobile payment simulation in modal.
[ ] FEATURE: SMS or Email confirmation notification when flight ticket is booked.
[ ] FEATURE: Print Boarding Pass button that formats directly for PDF download.
[ ] FEATURE: Multi-city / Round-trip return flight booking flow.
[ ] FEATURE: Filter flights by specific Bangladeshi Airlines (Biman, US-Bangla, Novoair).
[ ] OPTIONAL BACKEND: Create an alternative Python (Flask/FastAPI) server.py for users
    who prefer Python over Node.js (reusing the exact same public/ frontend).
[ ] CUSTOM DESIGN: Add more high-resolution airline fleet banners in images/ folder.

--------------------------------------------------------------------------------
HOW TO UPDATE THIS FILE IN THE FUTURE:
Whenever you ask for new modifications, you can ask to update this README.txt
with what was changed, so your project log remains permanently up-to-date!

================================================================================
Project Author & Maintainer: mahin1710
Repository: Skynet Flight Booking System
================================================================================
