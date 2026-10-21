(() => {
    'use strict';

    const config = JSON.parse(document.getElementById('portal-config').textContent);
    const $ = id => document.getElementById(id);
    const storageKey = 'pisowifi-demo-v1';
    const empty = () => ({ coins: 0, points: 0, remaining: 0, deadline: null, used: [] });
    let storageAvailable = true;

    function read() {
        try {
            const saved = JSON.parse(localStorage.getItem(storageKey));
            if (!saved || !Number.isFinite(saved.remaining) || saved.remaining < 0 ||
                !Number.isFinite(saved.coins) || saved.coins < 0 ||
                !Number.isFinite(saved.points) || saved.points < 0 ||
                !(saved.deadline === null || (Number.isFinite(saved.deadline) && saved.deadline > 0)) ||
                !Array.isArray(saved.used)) return empty();
            return {
                coins: saved.coins,
                points: saved.points,
                remaining: saved.remaining,
                deadline: saved.deadline,
                used: saved.used.filter(code => typeof code === 'string')
            };
        } catch (_) {
            return empty();
        }
    }

    let state = read();
    let pendingCoins = 0;
    let pendingMinutes = 0;

    // Slot payment countdown timer
    let slotCountdown = 60;
    let slotTimerInterval = null;
    let isSlotActive = false;

    const secondsLeft = () => state.deadline === null ? state.remaining : Math.max(0, Math.ceil((state.deadline - Date.now()) / 1000));

    function save() {
        try {
            localStorage.setItem(storageKey, JSON.stringify(state));
        } catch (_) {
            storageAvailable = false;
        }
    }

    function announce(text, error = false) {
        const msgEl = $('message');
        if (msgEl) {
            msgEl.textContent = text;
            msgEl.classList.toggle('error', error);
        }
    }

    function render() {
        const seconds = secondsLeft();
        const running = state.deadline !== null && seconds > 0;
        const status = seconds ? (running ? 'CONNECTED' : 'PAUSED') : 'LOADING CONNECTION...';

        const connStatusEl = $('connection-status');
        if (connStatusEl) {
            if (connStatusEl.textContent !== status) connStatusEl.textContent = status;
            connStatusEl.dataset.state = seconds ? (running ? 'connected' : 'paused') : 'disconnected';
        }

        if ($('coins')) $('coins').textContent = state.coins;
        if ($('points')) $('points').textContent = state.points;
        if ($('session')) $('session').hidden = !seconds;

        if ($('timer')) {
            $('timer').textContent = [
                Math.floor(seconds / 3600),
                Math.floor(seconds / 60) % 60,
                seconds % 60
            ].map(n => String(n).padStart(2, '0')).join(':');
        }

        if ($('pause')) $('pause').textContent = running ? 'Pause time' : 'Resume time';
        if (!storageAvailable && $('voucher-help')) {
            $('voucher-help').textContent = 'Browser storage is unavailable. This session lasts until the page closes.';
        }
    }

    function addTime(minutes) {
        state.remaining = secondsLeft() + minutes * 60;
        state.deadline = Date.now() + state.remaining * 1000;
        save();
        render();
    }

    function showDialog(id) {
        const dialog = $(id);
        if (dialog && typeof dialog.showModal === 'function') {
            dialog.showModal();
        }
    }

    // Play retro arcade coin chime synthesized via Web Audio API
    function playCoinChime() {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            if (!AudioCtx) return;
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';

            const now = ctx.currentTime;
            osc.frequency.setValueAtTime(987.77, now); // Note B5
            osc.frequency.setValueAtTime(1318.51, now + 0.08); // Note E6

            gain.gain.setValueAtTime(0.25, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

            osc.start(now);
            osc.stop(now + 0.35);
        } catch (_) {}
    }

    // Realtime Coin Slot Countdown Management
    function updateSlotTimerDisplay() {
        const timerEl = $('slot-timer');
        if (timerEl) timerEl.textContent = `${slotCountdown}s`;
    }

    function startSlotCountdown() {
        stopSlotCountdown();
        slotCountdown = 60;
        isSlotActive = true;
        updateSlotTimerDisplay();

        slotTimerInterval = setInterval(() => {
            slotCountdown--;
            updateSlotTimerDisplay();

            if (slotCountdown <= 0) {
                stopSlotCountdown();
                if (pendingMinutes > 0) {
                    commitPaymentSession();
                } else {
                    $('coin-dialog')?.close();
                    announce('Payment window expired. Click INSERT COIN to start again.');
                }
            }
        }, 1000);
    }

    function stopSlotCountdown() {
        if (slotTimerInterval) {
            clearInterval(slotTimerInterval);
            slotTimerInterval = null;
        }
        isSlotActive = false;
    }

    function renderPending() {
        if ($('pending-coins')) $('pending-coins').textContent = `₱${pendingCoins}`;
        if ($('pending-time')) $('pending-time').textContent = `${pendingMinutes} minutes`;
        if ($('connect')) $('connect').disabled = !pendingMinutes;
    }

    // Commit and credit session
    function commitPaymentSession() {
        if (!pendingMinutes) return;
        stopSlotCountdown();

        state.coins += pendingCoins;
        state.points += pendingCoins;
        const addedMins = pendingMinutes;

        addTime(addedMins);
        $('coin-dialog')?.close();
        announce(`Payment accepted! ${addedMins} minutes added. You are now CONNECTED.`);

        pendingCoins = 0;
        pendingMinutes = 0;
        renderPending();
    }

    // Realtime coin reception handler from Supabase
    function handleLiveCoinDrop(log) {
        const denom = Number(log.denomination || log.amount);
        if (!denom) return;

        // Lookup time for this denomination
        const rate = config.rates.find(r => r.pesos === denom) || { pesos: denom, minutes: denom * 5 };
        const mins = rate.minutes;

        playCoinChime();

        // If coin dialog isn't open, open it automatically so user sees live payment
        const coinDialog = $('coin-dialog');
        if (coinDialog && !coinDialog.open) {
            pendingCoins = 0;
            pendingMinutes = 0;
            renderPending();
            showDialog('coin-dialog');
            startSlotCountdown();
        }

        // Add to pending batch
        pendingCoins += denom;
        pendingMinutes += mins;
        renderPending();

        // Reset countdown timer back to 60s for subsequent coins
        slotCountdown = 60;
        updateSlotTimerDisplay();

        // Flash visual notification banner inside dialog with coin amount, WiFi time & timestamp
        const coinTimeStr = (log.created_at ? new Date(log.created_at) : new Date()).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });
        const alertEl = $('coin-alert');
        if (alertEl) {
            alertEl.textContent = `🪙 ₱${denom} Coin Entered! (+${mins} mins · ${coinTimeStr})`;
            alertEl.style.display = 'block';
            alertEl.classList.remove('coin-flash');
            void alertEl.offsetWidth;
            alertEl.classList.add('coin-flash');
        }
        announce(`🪙 ₱${denom} coin detected at ${coinTimeStr} (+${mins} mins). Total queued: ₱${pendingCoins} (${pendingMinutes} mins).`);

        console.log(`[PisoWiFi Realtime] Received ₱${denom} coin. Total pending: ₱${pendingCoins} (${pendingMinutes} mins)`);
    }

    // Initialize Supabase Realtime Listener
    let supabaseClient = null;
    function initSupabaseRealtime() {
        try {
            let savedUrl = localStorage.getItem('SMARTCOIN_SUPABASE_URL');
            let savedKey = localStorage.getItem('SMARTCOIN_SUPABASE_KEY');

            if (!savedUrl || savedUrl.includes('your-project-ref')) {
                savedUrl = window.DEFAULT_CONFIG?.SUPABASE_URL || '';
            }
            if (!savedKey || savedKey.includes('...')) {
                savedKey = window.DEFAULT_CONFIG?.SUPABASE_ANON_KEY || '';
            }

            if (window.supabase && savedUrl && savedKey) {
                supabaseClient = window.supabase.createClient(savedUrl, savedKey);

                // Listen to live DEPOSIT logs inserted by ESP32
                supabaseClient
                    .channel('portal-coin-listener')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coin_logs' }, payload => {
                        if (payload.new && payload.new.event_type === 'DEPOSIT') {
                            handleLiveCoinDrop(payload.new);
                        }
                    })
                    .subscribe();

                console.log('[PisoWiFi] Connected to Supabase Realtime for live coin detection');
            }
        } catch (err) {
            console.warn('[PisoWiFi] Supabase Realtime init error:', err);
        }
    }

    // Event Listeners
    $('insert-coin')?.addEventListener('click', () => {
        pendingCoins = 0;
        pendingMinutes = 0;
        const alertEl = $('coin-alert');
        if (alertEl) alertEl.style.display = 'none';

        renderPending();
        startSlotCountdown();
        showDialog('coin-dialog');
    });

    $('wifi-rates')?.addEventListener('click', () => showDialog('rates-dialog'));

    document.querySelectorAll('[data-close]').forEach(button => {
        button.addEventListener('click', () => {
            const dialog = button.closest('dialog');
            if (dialog?.id === 'coin-dialog') {
                stopSlotCountdown();
                // If user pressed cancel after coins were inserted, credit their time anyway!
                if (pendingMinutes > 0) {
                    commitPaymentSession();
                    return;
                }
            }
            dialog?.close();
        });
    });

    // Manual/Demo coin buttons fallback
    document.querySelectorAll('[data-pesos]').forEach(button => {
        button.addEventListener('click', () => {
            const rate = config.rates.find(item => item.pesos === Number(button.dataset.pesos));
            if (!rate) return;

            playCoinChime();
            pendingCoins += rate.pesos;
            pendingMinutes += rate.minutes;
            slotCountdown = 60;
            updateSlotTimerDisplay();
            renderPending();

            const alertEl = $('coin-alert');
            if (alertEl) {
                alertEl.textContent = `🪙 ₱${rate.pesos} Coin Added! (+${rate.minutes} minutes)`;
                alertEl.style.display = 'block';
            }
        });
    });

    // Connect / Start Session Button
    $('connect')?.addEventListener('click', () => {
        commitPaymentSession();
    });

    // Pause / Resume Session
    $('pause')?.addEventListener('click', () => {
        const seconds = secondsLeft();
        if (!seconds) return;
        const wasRunning = state.deadline !== null;
        state.remaining = seconds;
        state.deadline = wasRunning ? null : Date.now() + seconds * 1000;
        save();
        render();
        announce(wasRunning ? 'Session time paused. Resume whenever you are ready.' : 'Session time resumed.');
    });

    // Voucher Form Submission
    document.querySelectorAll('[data-voucher]').forEach(button => {
        button.addEventListener('click', () => {
            if ($('voucher')) {
                $('voucher').value = button.dataset.voucher;
                $('voucher').focus();
            }
        });
    });

    $('voucher-form')?.addEventListener('submit', event => {
        event.preventDefault();
        const voucherInput = $('voucher');
        if (!voucherInput) return;

        const code = voucherInput.value.trim().toUpperCase();
        let error = '';
        if (!code) error = 'Enter a voucher code first.';
        else if (!Object.prototype.hasOwnProperty.call(config.vouchers, code)) error = 'Invalid voucher code.';
        else if (state.used.includes(code)) error = 'This voucher has already been used.';

        if (error) {
            voucherInput.setAttribute('aria-invalid', 'true');
            announce(error, true);
            return;
        }

        state.used.push(code);
        addTime(config.vouchers[code]);
        voucherInput.value = '';
        voucherInput.removeAttribute('aria-invalid');
        announce(`Voucher accepted! ${config.vouchers[code]} minutes added.`);
    });

    $('voucher')?.addEventListener('input', () => $('voucher').removeAttribute('aria-invalid'));

    // Reset Demo / Session Dialog
    $('reset')?.addEventListener('click', () => showDialog('reset-dialog'));
    $('confirm-reset')?.addEventListener('click', () => {
        state = empty();
        save();
        render();
        if ($('voucher')) {
            $('voucher').value = '';
            $('voucher').removeAttribute('aria-invalid');
        }
        $('reset-dialog')?.close();
        announce('Session reset. Insert a coin or use a voucher to begin.');
    });

    // Admin Login Modal Handlers
    function showAdminDialog() {
        const adminErr = $('admin-error');
        const adminPin = $('admin-pin');
        if (adminErr) { adminErr.style.display = 'none'; adminErr.textContent = ''; }
        if (adminPin) { adminPin.value = ''; }
        showDialog('admin-dialog');
        setTimeout(() => { if (adminPin) adminPin.focus(); }, 100);
    }

    $('admin-login-btn')?.addEventListener('click', showAdminDialog);
    $('admin-footer-btn')?.addEventListener('click', showAdminDialog);

    $('admin-form')?.addEventListener('submit', e => {
        e.preventDefault();
        const pin = ($('admin-pin')?.value || '').trim();
        const adminErr = $('admin-error');

        if (pin === '1234' || pin === 'admin' || pin === 'smartcoin') {
            sessionStorage.setItem('SMARTCOIN_ADMIN_AUTH', 'true');
            if (adminErr) adminErr.style.display = 'none';
            $('admin-dialog')?.close();
            window.location.href = '../admin.html';
        } else {
            if (adminErr) {
                adminErr.textContent = 'Incorrect PIN code.';
                adminErr.style.display = 'block';
            }
            $('admin-pin')?.focus();
        }
    });

    // 1-second countdown interval
    function tick() {
        if (state.deadline !== null && secondsLeft() === 0) {
            state.remaining = 0;
            state.deadline = null;
            save();
            announce('Your connection time has ended. Insert coins or a voucher to reconnect.');
        }
        render();
    }

    // Storage event sync across tabs
    window.addEventListener('storage', event => {
        if (event.key === storageKey || event.key === null) {
            state = read();
            tick();
        }
    });

    document.addEventListener('visibilitychange', tick);

    // Initial boot
    tick();
    setInterval(tick, 1000);
    initSupabaseRealtime();
})();
