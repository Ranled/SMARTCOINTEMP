<?php
$config = require __DIR__ . '/config.php';
function escape($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
header('Content-Type: text/html; charset=utf-8');
?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="theme-color" content="#424e52">
    <meta name="description" content="A screenshot-inspired PisoWiFi portal frontend with simulated coins, vouchers and connection time.">
    <title><?= escape($config['name']) ?> · PisoWiFi</title>
    <link rel="icon" href="assets/wifi.svg" type="image/svg+xml">
    <link rel="stylesheet" href="assets/style.css">
    <script id="portal-config" type="application/json"><?= json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE) ?></script>
    <script src="assets/app.js" defer></script>
</head>
<body>
<div class="portal">
    <header class="hero">
        <img src="assets/game-banner.jpg" width="914" height="476" alt="Helmeted game character in front of an explosion" fetchpriority="high">
        <span class="network-label"><img src="assets/wifi.svg" width="18" height="18" alt=""> <?= escape($config['name']) ?></span>
        <button id="admin-login-btn" class="admin-top-btn" type="button" title="Access Admin Vault Monitor">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
            <span>ADMIN</span>
        </button>
    </header>
    <main class="main">
        <section class="connection" aria-labelledby="connection-status">
            <h1 id="connection-status" role="status">DISCONNECTED</h1>
            <p class="device">MAC: <?= escape($config['demo_mac']) ?> <span class="separator">|</span> IP: <?= escape($config['demo_ip']) ?></p>
            <p class="balance">COINS: ₱ <span id="coins">0</span> | POINTS: <span id="points">0</span></p>
            <div id="session" class="session" hidden>
                <p class="eyebrow" id="time-label">TIME REMAINING</p>
                <p id="timer" class="timer" aria-labelledby="time-label">00:00:00</p>
                <button id="pause" class="text-button" type="button">Pause time</button>
            </div>
        </section>
        <div class="controls">
            <button class="button primary" id="insert-coin" type="button">INSERT COIN</button>
            <button class="button secondary" id="wifi-rates" type="button">WIFI RATES</button>
            <form id="voucher-form" class="voucher-form" novalidate>
                <label class="sr-only" for="voucher">Voucher code</label>
                <input id="voucher" name="voucher" placeholder="Voucher Here.." autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="32" aria-describedby="voucher-help message">
                <button type="submit">SUBMIT</button>
            </form>
            <p id="message" class="message" role="status" aria-live="polite"></p>
            <p id="voucher-help" class="demo-codes">Try a demo voucher: <button type="button" class="code-button" data-voucher="PISO30">PISO30</button> or <button type="button" class="code-button" data-voucher="WIFI60">WIFI60</button></p>
        </div>
        <aside class="demo-note"><span class="demo-dot" aria-hidden="true"></span> FRONTEND DEMO <p>Simulated coins, device details & connection.<br>No payment or internet access is provided.</p></aside>
        <button id="reset" class="text-button reset" type="button">Reset demo</button>
        <noscript><p class="noscript">Enable JavaScript to try the coin, timer and voucher simulations.</p></noscript>
    </main>
    <footer><p><strong>Powered by: <span>PisoWiFi</span></strong> · <?= date('Y') ?></p><p>Connect. Play. Enjoy.</p></footer>
</div>

<dialog id="coin-dialog" aria-labelledby="coin-title" aria-describedby="coin-description">
    <div class="dialog-heading"><span class="eyebrow">ADD SOME TIME</span><button class="close" type="button" data-close aria-label="Close coin window">×</button></div>
    <h2 id="coin-title">Insert coin</h2>
    <p id="coin-description" class="dialog-copy">Choose a coin below to simulate insertion.</p>
    <div class="coin-options">
        <?php foreach ($config['rates'] as $rate): ?>
        <button type="button" class="coin" data-pesos="<?= escape($rate['pesos']) ?>" aria-label="Add <?= escape($rate['pesos']) ?> peso demo coin"><span>₱<?= escape($rate['pesos']) ?></span><small><?= escape($rate['label']) ?></small></button>
        <?php endforeach; ?>
    </div>
    <div class="coin-summary" role="status" aria-live="polite"><span>Coins inserted <strong id="pending-coins">₱0</strong></span><span>Time to add <strong id="pending-time">0 minutes</strong></span></div>
    <button id="connect" class="button primary dialog-action" type="button" disabled>START SESSION</button>
    <button type="button" class="text-button cancel" data-close>Cancel</button>
    <p class="small-note">Demo only. No real coin slot or payment is connected.</p>
</dialog>

<dialog id="rates-dialog" aria-labelledby="rates-title">
    <div class="dialog-heading"><span class="eyebrow">A LITTLE COIN, MORE TIME</span><button class="close" type="button" data-close aria-label="Close rates">×</button></div>
    <h2 id="rates-title">WiFi rates</h2><p class="dialog-copy">Sample rates for this frontend demo.</p>
    <table><thead><tr><th scope="col">COIN</th><th scope="col">CONNECTION TIME</th></tr></thead><tbody>
        <?php foreach ($config['rates'] as $rate): ?>
        <tr><td>₱<?= escape($rate['pesos']) ?></td><td><?= escape($rate['label']) ?></td></tr>
        <?php endforeach; ?>
    </tbody></table>
    <p class="small-note">Coins add up. Pause your timer and resume any time.<br>Demo vouchers: PISO30 (30 min) · WIFI60 (1 hour).</p>
    <button class="button primary dialog-action" type="button" data-close>GOT IT</button>
</dialog>

<dialog id="reset-dialog" aria-labelledby="reset-title">
    <div class="dialog-heading"><span class="eyebrow">START FRESH</span><button class="close" type="button" data-close aria-label="Close reset">×</button></div>
    <h2 id="reset-title">Reset this demo?</h2><p class="dialog-copy">Clear your simulated time, coins, points and redeemed vouchers in this browser.</p>
    <button id="confirm-reset" class="button primary dialog-action" type="button">RESET DEMO</button>
    <button class="text-button cancel" type="button" data-close>Keep my session</button>
</dialog>

<!-- Admin Login Dialog -->
<dialog id="admin-dialog" aria-labelledby="admin-title">
    <div class="dialog-heading"><span class="eyebrow">RESTRICTED ACCESS</span><button class="close" type="button" data-close aria-label="Close admin login">×</button></div>
    <h2 id="admin-title">Admin Login</h2>
    <p class="dialog-copy">Enter administrator PIN code to access the SmartCoin Vault Monitor & Transaction Logs.</p>
    <form id="admin-form" novalidate>
        <div style="margin-bottom: 14px;">
            <label class="sr-only" for="admin-pin">Admin PIN code</label>
            <input type="password" id="admin-pin" placeholder="Enter PIN (Default: 1234)" autocomplete="current-password" maxlength="20" style="width: 100%; padding: 14px 18px; border-radius: 14px; border: 1.5px solid #71878e; background: #263339; color: #fff; text-align: center; font-size: 20px; letter-spacing: 5px; outline: none;">
        </div>
        <p id="admin-error" class="message error" style="margin: 6px 0 14px; display: none;"></p>
        <button id="admin-submit-btn" class="button primary dialog-action" type="submit">ENTER SYSTEM</button>
        <button type="button" class="text-button cancel" data-close>Cancel</button>
        <p class="small-note">Default PIN: <code>1234</code> or <code>admin</code></p>
    </form>
</dialog>
</body>
</html>
