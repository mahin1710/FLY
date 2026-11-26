# FLY — Local Network Mobile QR Setup Guide

Follow these steps to scan and verify a FLY e-ticket QR code from your smartphone while connected to the same Wi-Fi/LAN as your computer.

---

## 1. Prerequisites & Network Rules
- Connect both your computer and mobile phone to the **same private Wi-Fi network** (avoid guest Wi-Fi with AP/client isolation enabled, as client isolation blocks device-to-device traffic).
- Your QR verification URLs **never** use `localhost` or `127.0.0.1`, because a phone opening `localhost` connects to the phone itself instead of your computer.

## 2. Find Your Computer's LAN IPv4 Address (Optional Manual Override)
On Windows PowerShell:
```powershell
ipconfig | Select-String "IPv4"
# Example output: IPv4 Address. . . . . . . . . . . : 192.168.1.119
```
> **Convenience Note:** In `FLASK_ENV=development`, FLY automatically detects your non-loopback LAN IPv4 address (`Config.detect_lan_ipv4()` in `config.py`) when `QR_VERIFY_BASE_URL` is left blank. Never trust untrusted HTTP `Host` headers for public QR generation.

## 3. Configure `.env` (Manual Override Recommended for Fixed DHCP Reservation)
For stable regular testing, assign a DHCP reservation on your router and optionally set in `.env`:
```env
FLASK_ENV=development
HOST=0.0.0.0
PORT=5000
QR_VERIFY_BASE_URL=http://192.168.1.119:5000
```
In **production**, enforce HTTPS:
```env
FLASK_ENV=production
QR_VERIFY_BASE_URL=https://tickets.fly-booking.com
ALLOWED_ORIGINS=https://tickets.fly-booking.com
```

## 4. Allow Inbound Port 5000 Through Windows Firewall (LAN Only)
If your phone times out reaching `http://<LAN_IP>:5000`, allow Python / TCP port `5000` on your **Private** Windows Firewall profile:
```powershell
New-NetFirewallRule -DisplayName "FLY Local Dev Port 5000" -Direction Inbound -Protocol TCP -LocalPort 5000 -Action Allow -Profile Private
```

## 5. Start the Server Bound to `0.0.0.0`
```powershell
python app.py
```
Look at the startup log to confirm the active LAN URL printed at launch:
```text
Server running on http://0.0.0.0:5000
QR Verify Base URL (development): http://192.168.1.119:5000
```

## 6. Test Scanning With Your Mobile Phone
1. Open `http://localhost:5000` on your computer and log in (e.g., `Mahin0` / `Mahin0`).
2. Complete a test booking checkout to issue an e-ticket (`/ticket/<PNR>`).
3. Open your phone's built-in **Camera** app (no third-party app required) and point it at the QR code on screen or inside the downloaded PDF (`Download PDF`).
4. Tap the `http://<LAN_IP>:5000/ticket/verify/<TOKEN>` link.
5. Verify the mobile browser loads **VALID — TICKET ISSUED** (marked `TEST FIXTURE TICKET` in development) with masked passenger details.
6. If the computer server is stopped or the phone leaves the Wi-Fi, reloading shows:
   *"FLY verification server is currently unreachable. Please connect to the same network and try again."*
