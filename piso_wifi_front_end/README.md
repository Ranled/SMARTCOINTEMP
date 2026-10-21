# PisoWiFi frontend demo

A runnable PHP captive-portal **frontend only**, based on the screenshot attached to the original “Create Pisowifi Frontend” conversation. It recreates the game banner, slate background, turquoise status text, coin/rates buttons, voucher form and footer. The Android status bar and captive-browser address bar belong to the phone and are intentionally excluded.

## Run with XAMPP on Windows

1. Extract the ZIP. Copy the whole `pisowifi` folder into `C:\xampp\htdocs\`.
2. Check that `C:\xampp\htdocs\pisowifi\index.php` exists (avoid nesting `pisowifi\pisowifi`).
3. Open **XAMPP Control Panel** and click **Start** beside **Apache**. MySQL is not needed.
4. Open **http://localhost/pisowifi/** in your browser.

If Apache uses another port, include it, for example `http://localhost:8080/pisowifi/`. Use the HTTP address instead of double-clicking `index.php`. A Desktop copy is the source folder; Apache serves the copy in `htdocs`.

### PHP built-in server (alternative)

In PowerShell, from the `pisowifi` folder:

```powershell
& 'C:\xampp\php\php.exe' -S 127.0.0.1:8080
```

Then open **http://127.0.0.1:8080/**. Stop the server with Ctrl+C.

## Try the demo

- **INSERT COIN** opens a simulated coin window. Add one or more ₱1, ₱5, ₱10 or ₱20 coins, then select **START SESSION**. Cancel/close/Escape discards uncommitted coins.
- **WIFI RATES** shows the sample price/time table. Each coin adds its listed time; coins are additive, not converted into a different package.
- **PISO30** adds 30 minutes; **WIFI60** adds 60 minutes. Codes ignore letter case and surrounding spaces. Each code can be redeemed once per saved demo. Click a suggested code to fill the voucher field, then submit it.
- **Pause time / Resume time** controls the demo countdown. Buying time or redeeming a voucher resumes a paused session and adds to existing time.
- The timer uses an absolute timestamp, so it continues during refresh and while the browser is closed. Paused time stays paused. Expiration returns the view to **DISCONNECTED**.
- Coins count committed demo pesos; points increase by one per demo peso. Neither is spendable or redeemable. Vouchers add time without increasing coins or points.
- **Reset demo** asks before clearing the current browser's simulated session, coins, points and used vouchers. There are no real purchases.

## Files and customization

```text
pisowifi/
  index.php                PHP-rendered page and dialogs
  config.php               Network label, demo device details, rates, vouchers
  assets/
    style.css              Responsive layout and reference colors
    app.js                 Browser-only demo interactions and timer
    game-banner.jpg        Hero extracted from the user's screenshot
    wifi.svg               Local vector icon
  README.md
  ASSETS.md
```

Edit `config.php` for the network name, example MAC/IP, rates and voucher mapping. Keep coin values unique positive integers and minutes positive. If you change voucher names, also update the suggested-code buttons and help copy in `index.php` and messages in `assets/app.js`. Edit the color variables at the top of `assets/style.css` to change the theme. Replace `assets/game-banner.jpg` with your own banner as needed.

No Composer, Node, database, CDN, API keys or internet connection are required. Use PHP 7.4+ or PHP 8.x and a modern browser supporting HTML dialogs, JavaScript and localStorage. Keyboard focus, Escape-to-close dialogs, form labels, status announcements and reduced-motion preferences are supported.

## Scope

All time, balance and voucher state lives in **localStorage in this browser and origin** (`pisowifi-demo-v1`). It can be edited or cleared in browser tools. If storage is blocked, the current page still works but state is not retained after closing/reloading. Different browsers, ports and URLs have separate demo state.

The MAC/IP are static examples from the reference image, not detected device values. “CONNECTED” is a simulated display state. This project does not detect coins, take payments, change router/firewall settings, authenticate devices, redirect captive clients, provide WiFi, or grant/revoke internet access. Voucher codes are intentionally public frontend demo data. This is not a production billing or access-control system.

## Verification

Checked on 21 October 2026 with PHP 8.2.12: PHP syntax checks and JavaScript syntax passed. Browser checks covered the rendered portal and rates dialog, additive coins (₱1 + ₱5 = 35 minutes), cancellation, pause persistence on refresh, successful/invalid/reused vouchers, and reset. Layouts were visually checked at desktop size and at 390px and 320px mobile widths. Automated checks also covered timer expiration, paused/resumed time, voucher normalization, corrupt saved data, and unavailable browser storage. Hardware, router and XAMPP Apache integration are outside this frontend demo; runtime verification used PHP's built-in local server.
