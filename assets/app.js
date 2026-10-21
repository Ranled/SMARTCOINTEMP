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

    // Shared Web Audio API Context (unlocked on first user interaction so async coin drops always play sound)
    let sharedAudioCtx = null;
    function getAudioContext() {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        if (!sharedAudioCtx) {
            sharedAudioCtx = new AudioCtx();
        }
        if (sharedAudioCtx.state === 'suspended') {
            sharedAudioCtx.resume().catch(() => {});
        }
        return sharedAudioCtx;
    }

    // Unlock audio context on any user tap/click/key
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(evt => {
        window.addEventListener(evt, () => getAudioContext(), { passive: true });
    });

    // Play retro arcade coin chime + voice announcement when coin is inserted
    function playCoinChime(denom = 0, mins = 0) {
        try {
            const ctx = getAudioContext();
            if (ctx) {
                const now = ctx.currentTime;

                // Dual-oscillator rich arcade coin chime (B5 -> E6 -> B6)
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();

                osc1.type = 'triangle';
                osc2.type = 'sine';

                osc1.frequency.setValueAtTime(987.77, now);        // B5
                osc1.frequency.setValueAtTime(1318.51, now + 0.08); // E6
                osc1.frequency.setValueAtTime(1975.53, now + 0.18); // B6

                osc2.frequency.setValueAtTime(1975.53, now);        // Harmonic
                osc2.frequency.setValueAtTime(2637.02, now + 0.08);

                gain.gain.setValueAtTime(0.6, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(ctx.destination);

                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 0.55);
                osc2.stop(now + 0.55);
            }
        } catch (_) {}

        // Optional voice prompt ("1 peso inserted, plus 5 minutes")
        try {
            if (denom > 0 && 'speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const text = denom === 1
                    ? `1 peso inserted, plus ${mins} minutes`
                    : `${denom} pesos inserted, plus ${mins} minutes`;
                const utter = new SpeechSynthesisUtterance(text);
                utter.rate = 1.08;
                utter.volume = 1.0;
                window.speechSynthesis.speak(utter);
            }
        } catch (_) {}
    }

    // Short activation beep + voice prompt when user clicks INSERT COIN
    function playSlotReadySound() {
        try {
            const ctx = getAudioContext();
            if (ctx) {
                const now = ctx.currentTime;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(659.25, now); // E5
                osc.frequency.setValueAtTime(880.00, now + 0.08); // A5
                osc.frequency.setValueAtTime(1174.66, now + 0.16); // D6
                gain.gain.setValueAtTime(0.45, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.start(now);
                osc.stop(now + 0.32);
            }
        } catch (_) {}

        try {
            if ('speechSynthesis' in window) {
                window.speechSynthesis.cancel();
                const utter = new SpeechSynthesisUtterance('Please insert your coin now');
                utter.rate = 1.05;
                utter.volume = 1.0;
                window.speechSynthesis.speak(utter);
            }
        } catch (_) {}
    }

    // Connected chime when START SESSION is clicked
    function playSessionStartSound() {
        try {
            const ctx = getAudioContext();
            if (!ctx) return;
            const now = ctx.currentTime;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(523.25, now);       // C5
            osc.frequency.setValueAtTime(659.25, now + 0.09); // E5
            osc.frequency.setValueAtTime(783.99, now + 0.18); // G5
            osc.frequency.setValueAtTime(1046.50, now + 0.27); // C6
            gain.gain.setValueAtTime(0.45, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now);
            osc.stop(now + 0.55);
        } catch (_) {}
    }

    // Realtime Coin Slot Countdown Management
    function updateSlotTimerDisplay() {
        const timerEl = $('slot-timer');
        if (timerEl) timerEl.textContent = `${slotCountdown}s`;
        const fillEl = $('slot-progress-fill');
        if (fillEl) fillEl.style.width = `${Math.max(0, Math.min(100, (slotCountdown / 60) * 100))}%`;
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
        if ($('connect')) {
            $('connect').disabled = false;
            $('connect').textContent = pendingMinutes > 0
                ? `START SESSION (+${pendingMinutes} MINS)`
                : 'START SESSION';
        }
    }

    // Commit and credit session
    async function commitPaymentSession() {
        if (!pendingMinutes) {
            await pollLatestCoinLogs();
        }
        if (!pendingMinutes) {
            const alertEl = $('coin-alert');
            if (alertEl) {
                alertEl.textContent = '⚠️ Please insert a coin into the slot first (₱1 = 5 mins, ₱5 = 30 mins, ₱10 = 1 hr, ₱20 = 3 hrs).';
                alertEl.style.display = 'block';
            }
            announce('Please insert a coin into the slot first to start your session.', true);
            return;
        }
        stopSlotCountdown();

        state.coins += pendingCoins;
        state.points += pendingCoins;
        const addedMins = pendingMinutes;

        addTime(addedMins);
        playSessionStartSound();
        $('coin-dialog')?.close();
        announce(`Payment accepted! ${addedMins} minutes added. You are now CONNECTED.`);

        pendingCoins = 0;
        pendingMinutes = 0;
        renderPending();
    }

    // Track processed log IDs so Realtime + Polling never double-count a coin
    let lastProcessedLogId = null;

    // Realtime coin reception handler from Supabase
    function handleLiveCoinDrop(log) {
        if (log && log.id) {
            if (lastProcessedLogId !== null && Number(log.id) <= lastProcessedLogId) {
                return;
            }
            lastProcessedLogId = Number(log.id);
        }

        const denom = Number(log.denomination || log.amount);
        if (!denom) return;

        // Lookup time for this denomination
        const rate = config.rates.find(r => r.pesos === denom) || { pesos: denom, minutes: denom * 5 };
        const mins = rate.minutes;

        playCoinChime(denom, mins);

        // If coin dialog isn't open, open it automatically so user sees live payment
        const coinDialog = $('coin-dialog');
        if (coinDialog && !coinDialog.open) {
            showDialog('coin-dialog');
            startSlotCountdown();
        }

        // Add to pending batch
        pendingCoins += denom;
        pendingMinutes += mins;
        renderPending();

        if ($('coin-title')) $('coin-title').textContent = `🪙 +₱${denom} ACCEPTED!`;
        if ($('slot-hero-badge-text')) $('slot-hero-badge-text').textContent = 'COIN RECEIVED! DROP MORE OR START SESSION';

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

    // Fast polling fallback in case WebSocket Realtime is delayed or blocked
    let supabaseClient = null;
    async function pollLatestCoinLogs() {
        if (!supabaseClient) return;
        try {
            const { data, error } = await supabaseClient
                .from('coin_logs')
                .select('*')
                .order('id', { ascending: false })
                .limit(5);

            if (error || !data || data.length === 0) return;

            if (lastProcessedLogId === null) {
                lastProcessedLogId = Number(data[0].id);
                return;
            }

            // Process any new DEPOSIT logs in chronological order
            const newDeposits = data
                .filter(row => Number(row.id) > lastProcessedLogId && row.event_type === 'DEPOSIT')
                .reverse();

            for (const dep of newDeposits) {
                handleLiveCoinDrop(dep);
            }

            if (Number(data[0].id) > lastProcessedLogId) {
                lastProcessedLogId = Number(data[0].id);
            }
        } catch (_) {}
    }

    // Initialize Supabase Realtime Listener + 1.5s Polling
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

                // Seed latest log ID on boot and start 1.5s fast poll fallback
                pollLatestCoinLogs();
                setInterval(pollLatestCoinLogs, 1500);

                // Listen to live DEPOSIT logs inserted by ESP32
                supabaseClient
                    .channel('portal-coin-listener')
                    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coin_logs' }, payload => {
                        if (payload.new && payload.new.event_type === 'DEPOSIT') {
                            handleLiveCoinDrop(payload.new);
                        }
                    })
                    .subscribe();

                console.log('[PisoWiFi] Connected to Supabase Realtime + 1.5s polling for live coin detection');
            }
        } catch (err) {
            console.warn('[PisoWiFi] Supabase Realtime init error:', err);
        }
    }

        // Event Listeners
    $('insert-coin')?.addEventListener('click', () => {
        playSlotReadySound();
        if (pendingMinutes === 0) {
            const alertEl = $('coin-alert');
            if (alertEl) alertEl.style.display = 'none';
            if ($('coin-title')) $('coin-title').textContent = 'INSERT COINS NOW!';
            if ($('slot-hero-badge-text')) $('slot-hero-badge-text').textContent = 'COIN SLOT OPEN & READY';
        }
        renderPending();
        startSlotCountdown();
        showDialog('coin-dialog');
        pollLatestCoinLogs();
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

    // End Session Dialog & Handlers
    $('reset')?.addEventListener('click', () => showDialog('reset-dialog'));
    $('end-session')?.addEventListener('click', () => showDialog('reset-dialog'));
    $('confirm-reset')?.addEventListener('click', () => {
        state = empty();
        save();
        render();
        if ($('voucher')) {
            $('voucher').value = '';
            $('voucher').removeAttribute('aria-invalid');
        }
        $('reset-dialog')?.close();
        announce('Session ended. Insert a coin to start a new session.');
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
            window.location.href = 'admin.html';
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
            state = empty();
            save();
            announce('Session ended! Your connection time has finished. Insert a coin to start a new session.');
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
