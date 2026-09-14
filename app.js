// ========================================================
// SMARTCOIN GROUP 4 - APPLICATION LOGIC & REALTIME SYNC
// ========================================================

let supabaseClient = null;
let currentContainer = {
  count_1: 0,
  count_5: 0,
  count_10: 0,
  count_20: 0,
  total_pesos: 0,
  last_action: 'INITIALIZED',
  updated_at: new Date().toISOString()
};

let transactionLogs = [];
let activeFilter = 'ALL';

// DOM Elements
const syncStatusEl = document.getElementById('syncStatus');
const syncTextEl = syncStatusEl.querySelector('.sync-text');
const totalAmountEl = document.getElementById('totalAmount');
const totalCoinsCountEl = document.getElementById('totalCoinsCount');
const lastUpdatedEl = document.getElementById('lastUpdated');

const count1El = document.getElementById('count1');
const count5El = document.getElementById('count5');
const count10El = document.getElementById('count10');
const count20El = document.getElementById('count20');

const subtotal1El = document.getElementById('subtotal1');
const subtotal5El = document.getElementById('subtotal5');
const subtotal10El = document.getElementById('subtotal10');
const subtotal20El = document.getElementById('subtotal20');

const bar1El = document.getElementById('bar1');
const bar5El = document.getElementById('bar5');
const bar10El = document.getElementById('bar10');
const bar20El = document.getElementById('bar20');

const logsTableBody = document.getElementById('logsTableBody');
const filterBtns = document.querySelectorAll('.filter-btn');

// Modals
const configBtn = document.getElementById('configBtn');
const configModal = document.getElementById('configModal');
const closeConfigBtn = document.getElementById('closeConfigBtn');
const cancelConfigBtn = document.getElementById('cancelConfigBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const supabaseUrlInput = document.getElementById('supabaseUrlInput');
const supabaseKeyInput = document.getElementById('supabaseKeyInput');

const withdrawBtn = document.getElementById('withdrawBtn');
const withdrawModal = document.getElementById('withdrawModal');
const closeWithdrawBtn = document.getElementById('closeWithdrawBtn');
const cancelWithdrawBtn = document.getElementById('cancelWithdrawBtn');
const confirmWithdrawBtn = document.getElementById('confirmWithdrawBtn');
const modalWithdrawAmount = document.getElementById('modalWithdrawAmount');
const modalWithdrawCoins = document.getElementById('modalWithdrawCoins');
const withdrawNotesInput = document.getElementById('withdrawNotes');

// 1. Initialize Supabase Connection
function initSupabase() {
  let savedUrl = localStorage.getItem('SMARTCOIN_SUPABASE_URL');
  let savedKey = localStorage.getItem('SMARTCOIN_SUPABASE_KEY');

  if (!savedUrl || savedUrl.includes('your-project-ref')) {
    savedUrl = window.DEFAULT_CONFIG?.SUPABASE_URL || '';
  }
  if (!savedKey || savedKey.includes('...')) {
    savedKey = window.DEFAULT_CONFIG?.SUPABASE_ANON_KEY || '';
  }

  supabaseUrlInput.value = savedUrl;
  supabaseKeyInput.value = savedKey;

  if (!savedUrl || !savedKey || savedUrl.includes('your-project-ref')) {
    setConnectionState('DISCONNECTED', 'error');
    openConfigModal();
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(savedUrl, savedKey);
    setConnectionState('CONNECTED', 'connected');
    fetchContainerData();
    fetchLogs();
    subscribeToRealtime();
  } catch (err) {
    console.error('Supabase initialization error:', err);
    setConnectionState('ERROR', 'error');
    showToast('Failed to initialize Supabase client');
  }
}

function setConnectionState(text, stateClass) {
  syncTextEl.textContent = text;
  syncStatusEl.className = `sync-indicator ${stateClass}`;
}

// 2. Fetch Container Data
async function fetchContainerData() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('coin_container')
      .select('*')
      .eq('id', 1)
      .single();

    if (error) throw error;
    if (data) {
      updateContainerUI(data);
    }
  } catch (err) {
    console.error('Error fetching container data:', err);
  }
}

// 3. Fetch Logs
async function fetchLogs() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('coin_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    transactionLogs = data || [];
    renderLogsTable();
  } catch (err) {
    console.error('Error fetching logs:', err);
    logsTableBody.innerHTML = `<tr><td colspan="6" class="table-empty">Error loading transaction logs. Check connection.</td></tr>`;
  }
}

// 4. Realtime Subscription
function subscribeToRealtime() {
  if (!supabaseClient) return;

  // Listen to changes in coin_container
  supabaseClient
    .channel('container-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coin_container' }, payload => {
      if (payload.new) {
        // Detect which coin increased for pulse animation
        detectPulse(currentContainer, payload.new);
        updateContainerUI(payload.new);
      }
    })
    .subscribe();

  // Listen to inserts in coin_logs
  supabaseClient
    .channel('logs-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coin_logs' }, payload => {
      if (payload.new) {
        transactionLogs.unshift(payload.new);
        renderLogsTable();
        if (payload.new.event_type === 'DEPOSIT') {
          showToast(`🪙 +₱${payload.new.denomination || payload.new.amount} Coin Deposited! (Vault: ₱${payload.new.total_pesos})`);
        } else if (payload.new.event_type === 'WITHDRAWAL') {
          showToast(`💸 ₱${payload.new.amount} Disbursed from Vault!`);
        }
      }
    })
    .subscribe();
}

function detectPulse(oldData, newData) {
  if (newData.count_1 > oldData.count_1) {
    triggerCardPulse('card-p1');
    spawnFloatingCoinBadge('card-p1', 1);
  }
  if (newData.count_5 > oldData.count_5) {
    triggerCardPulse('card-p5');
    spawnFloatingCoinBadge('card-p5', 5);
  }
  if (newData.count_10 > oldData.count_10) {
    triggerCardPulse('card-p10');
    spawnFloatingCoinBadge('card-p10', 10);
  }
  if (newData.count_20 > oldData.count_20) {
    triggerCardPulse('card-p20');
    spawnFloatingCoinBadge('card-p20', 20);
  }
}

function triggerCardPulse(cardId) {
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.remove('pulse');
    void card.offsetWidth; // Trigger reflow
    card.classList.add('pulse');
  }
}

function spawnFloatingCoinBadge(cardId, denomination) {
  const card = document.getElementById(cardId);
  if (!card) return;

  const badge = document.createElement('div');
  badge.className = 'floating-coin-badge';
  badge.textContent = `+₱${denomination}`;
  card.appendChild(badge);

  setTimeout(() => {
    badge.remove();
  }, 1000);
}

// Smooth Number Roll Counter
function animateNumber(element, startVal, endVal, duration = 600, prefix = '', suffix = '') {
  if (startVal === endVal) {
    element.textContent = `${prefix}${endVal.toLocaleString()}${suffix}`;
    return;
  }

  // Trigger bounce animation
  element.classList.remove('bump');
  void element.offsetWidth;
  element.classList.add('bump');

  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const easeProgress = 1 - Math.pow(1 - progress, 3);
    const currentVal = Math.round(startVal + (endVal - startVal) * easeProgress);

    element.textContent = `${prefix}${currentVal.toLocaleString()}${suffix}`;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = `${prefix}${endVal.toLocaleString()}${suffix}`;
    }
  }

  requestAnimationFrame(update);
}

// 5. Update UI with Data
function updateContainerUI(data) {
  const prevData = { ...currentContainer };
  currentContainer = data;

  const count1 = data.count_1 || 0;
  const count5 = data.count_5 || 0;
  const count10 = data.count_10 || 0;
  const count20 = data.count_20 || 0;

  const sub1 = count1 * 1;
  const sub5 = count5 * 5;
  const sub10 = count10 * 10;
  const sub20 = count20 * 20;

  const totalAmount = data.total_pesos || (sub1 + sub5 + sub10 + sub20);
  const totalCoins = count1 + count5 + count10 + count20;

  const prevCount1 = prevData.count_1 || 0;
  const prevCount5 = prevData.count_5 || 0;
  const prevCount10 = prevData.count_10 || 0;
  const prevCount20 = prevData.count_20 || 0;
  const prevTotalAmount = prevData.total_pesos || 0;
  const prevTotalCoins = prevCount1 + prevCount5 + prevCount10 + prevCount20;

  // Animated Numbers
  animateNumber(totalAmountEl, prevTotalAmount, totalAmount);
  animateNumber(totalCoinsCountEl, prevTotalCoins, totalCoins, 500, '', ' PCS');

  // Denomination Counts
  animateNumber(count1El, prevCount1, count1);
  animateNumber(count5El, prevCount5, count5);
  animateNumber(count10El, prevCount10, count10);
  animateNumber(count20El, prevCount20, count20);

  // Subtotals
  subtotal1El.textContent = `₱${sub1.toLocaleString()}`;
  subtotal5El.textContent = `₱${sub5.toLocaleString()}`;
  subtotal10El.textContent = `₱${sub10.toLocaleString()}`;
  subtotal20El.textContent = `₱${sub20.toLocaleString()}`;

  // ₱100 Minimum Threshold Progress Bars (Percentage towards ₱100 threshold)
  const pct1 = Math.min((sub1 / 100) * 100, 100);
  const pct5 = Math.min((sub5 / 100) * 100, 100);
  const pct10 = Math.min((sub10 / 100) * 100, 100);
  const pct20 = Math.min((sub20 / 100) * 100, 100);

  bar1El.style.width = `${pct1}%`;
  bar5El.style.width = `${pct5}%`;
  bar10El.style.width = `${pct10}%`;
  bar20El.style.width = `${pct20}%`;

  // Goal info text
  updateThresholdInfo('progress1', 'statusBadge1', sub1);
  updateThresholdInfo('progress5', 'statusBadge5', sub5);
  updateThresholdInfo('progress10', 'statusBadge10', sub10);
  updateThresholdInfo('progress20', 'statusBadge20', sub20);

  // Check if any denomination is eligible (>= ₱100)
  const hasEligibleCoins = (sub1 >= 100 || sub5 >= 100 || sub10 >= 100 || sub20 >= 100);
  const eligibleCount = [sub1 >= 100, sub5 >= 100, sub10 >= 100, sub20 >= 100].filter(Boolean).length;

  if (hasEligibleCoins) {
    withdrawBtn.disabled = false;
    withdrawBtn.classList.remove('locked');
    withdrawBtn.title = `${eligibleCount} denomination(s) ready to withdraw (₱100+ reached)`;
    withdrawBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      WITHDRAW COINS
    `;
  } else {
    withdrawBtn.disabled = true;
    withdrawBtn.classList.add('locked');
    withdrawBtn.title = `Withdrawal Locked: No coin denomination has reached ₱100 yet`;
    withdrawBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
      🔒 LOCKED (&lt; ₱100)
    `;
  }

  // Quick direct withdrawal buttons on cards with strict locking indicators
  const btnQ1 = document.getElementById('quickWithdraw1');
  const btnQ5 = document.getElementById('quickWithdraw5');
  const btnQ10 = document.getElementById('quickWithdraw10');
  const btnQ20 = document.getElementById('quickWithdraw20');

  if (btnQ1) {
    btnQ1.disabled = (sub1 < 100);
    btnQ1.textContent = (sub1 < 100) ? '🔒 LOCKED (< ₱100)' : 'WITHDRAW ₱100 (100 PCS)';
  }
  if (btnQ5) {
    btnQ5.disabled = (sub5 < 100);
    btnQ5.textContent = (sub5 < 100) ? '🔒 LOCKED (< ₱100)' : 'WITHDRAW ₱100 (20 PCS)';
  }
  if (btnQ10) {
    btnQ10.disabled = (sub10 < 100);
    btnQ10.textContent = (sub10 < 100) ? '🔒 LOCKED (< ₱100)' : 'WITHDRAW ₱100 (10 PCS)';
  }
  if (btnQ20) {
    btnQ20.disabled = (sub20 < 100);
    btnQ20.textContent = (sub20 < 100) ? '🔒 LOCKED (< ₱100)' : 'WITHDRAW ₱100 (5 PCS)';
  }

  // Timestamp
  if (data.updated_at) {
    const timeStr = new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    lastUpdatedEl.textContent = `UPDATED ${timeStr}`;
  }
}

function updateThresholdInfo(progressId, badgeId, subtotal) {
  const progEl = document.getElementById(progressId);
  const badgeEl = document.getElementById(badgeId);
  if (!progEl || !badgeEl) return;

  if (subtotal >= 100) {
    progEl.textContent = `₱${subtotal} / ₱100 (READY)`;
    progEl.className = 'threshold-val met';
    badgeEl.textContent = `READY (₱${subtotal})`;
    badgeEl.className = 'coin-status-badge eligible';
  } else {
    progEl.textContent = `₱${subtotal} / ₱100 (Need ₱${100 - subtotal})`;
    progEl.className = 'threshold-val';
    badgeEl.textContent = `🔒 LOCKED (${subtotal}/₱100)`;
    badgeEl.className = 'coin-status-badge';
  }
}

// Quick ₱100 Withdrawal directly from coin card (with confirmation safety prompt)
window.quickWithdrawDenom = function(denom) {
  const countKey = `count_${denom}`;
  const currentCoins = currentContainer[countKey] || 0;
  const currentSubtotal = currentCoins * denom;

  if (currentSubtotal < 100) {
    showToast(`₱${denom} coins subtotal is only ₱${currentSubtotal}. Minimum ₱100 required.`);
    return;
  }

  // Calculate batch of ₱100 coins
  const withdrawCoins = 100 / denom; // e.g. 5 pcs of ₱20, 10 pcs of ₱10, 20 pcs of ₱5, 100 pcs of ₱1
  const withdrawAmount = 100;

  if (currentCoins < withdrawCoins) {
    showToast(`Not enough ₱${denom} coins for a ₱100 batch.`);
    return;
  }

  const remainingCoins = currentCoins - withdrawCoins;
  const remaining1 = (denom === 1) ? remainingCoins : (currentContainer.count_1 || 0);
  const remaining5 = (denom === 5) ? remainingCoins : (currentContainer.count_5 || 0);
  const remaining10 = (denom === 10) ? remainingCoins : (currentContainer.count_10 || 0);
  const remaining20 = (denom === 20) ? remainingCoins : (currentContainer.count_20 || 0);

  const remainingTotal = (remaining1 * 1) + (remaining5 * 5) + (remaining10 * 10) + (remaining20 * 20);
  const notes = `Direct ₱100 batch withdrawal of ₱${denom} coins (${withdrawCoins} pcs)`;

  // Open Safety Confirmation Modal to avoid accidental clicks!
  openConfirmationModal({
    amount: withdrawAmount,
    coinsText: `${withdrawCoins} pcs of ₱${denom} coins`,
    remaining: remainingTotal,
    onConfirm: async () => {
      showToast(`Processing ₱100 withdrawal of ₱${denom} coins...`);

      try {
        const withdrawalLogData = {
          event_type: 'WITHDRAWAL',
          denomination: denom,
          amount: withdrawAmount,
          count_1: remaining1,
          count_5: remaining5,
          count_10: remaining10,
          count_20: remaining20,
          total_pesos: remainingTotal,
          notes: `${notes} [Cleared: 1x${denom === 1 ? withdrawCoins : 0}, 5x${denom === 5 ? withdrawCoins : 0}, 10x${denom === 10 ? withdrawCoins : 0}, 20x${denom === 20 ? withdrawCoins : 0}]`
        };

        // 1. Insert log
        const { data: insertedLog, error: logError } = await supabaseClient
          .from('coin_logs')
          .insert([withdrawalLogData])
          .select()
          .single();

        if (logError) throw logError;

        // 2. Update container
        const { error: containerError } = await supabaseClient
          .from('coin_container')
          .update({
            count_1: remaining1,
            count_5: remaining5,
            count_10: remaining10,
            count_20: remaining20,
            total_pesos: remainingTotal,
            last_action: `WITHDRAWAL_₱100_P${denom}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);

        if (containerError) throw containerError;

        showToast(`Successfully withdrawn ₱100 (${withdrawCoins} pcs of ₱${denom})!`);

        // Show receipt
        openReceipt({
          id: insertedLog?.id || Date.now(),
          created_at: insertedLog?.created_at || new Date().toISOString(),
          amount: withdrawAmount,
          notes: notes,
          breakdown: {
            qty1: (denom === 1 ? withdrawCoins : 0),
            qty5: (denom === 5 ? withdrawCoins : 0),
            qty10: (denom === 10 ? withdrawCoins : 0),
            qty20: (denom === 20 ? withdrawCoins : 0)
          }
        });

        fetchContainerData();
        fetchLogs();
      } catch (err) {
        console.error('Quick withdrawal error:', err);
        showToast('Failed to execute quick withdrawal');
      }
    }
  });
};

// 6. Render Logs Table with Precise Denominations & Clean Formatting
function formatLogDenomination(log) {
  if (log.event_type === 'DEPOSIT') {
    return `<span class="badge-coin-tag">₱${log.denomination || log.amount}.00 Coin</span>`;
  }

  // For WITHDRAWAL: parse exact coins disbursed from notes or denomination
  if (log.notes) {
    const match = log.notes.match(/Cleared: 1x(\d+), 5x(\d+), 10x(\d+), 20x(\d+)/) ||
                  log.notes.match(/Cleared (\d+)x₱1, (\d+)x₱5, (\d+)x₱10, (\d+)x₱20/);
    if (match) {
      const q1 = parseInt(match[1]) || 0;
      const q5 = parseInt(match[2]) || 0;
      const q10 = parseInt(match[3]) || 0;
      const q20 = parseInt(match[4]) || 0;

      const items = [];
      if (q20 > 0) items.push(`${q20}x ₱20`);
      if (q10 > 0) items.push(`${q10}x ₱10`);
      if (q5 > 0) items.push(`${q5}x ₱5`);
      if (q1 > 0) items.push(`${q1}x ₱1`);

      if (items.length > 0) {
        return `<span class="badge-coin-tag withdrawn">${items.join(', ')}</span>`;
      }
    }
  }

  if (log.denomination > 0) {
    const count = log.amount && log.denomination ? Math.round(log.amount / log.denomination) : 0;
    return `<span class="badge-coin-tag withdrawn">₱${log.denomination} (${count} pcs)</span>`;
  }

  return `<span class="badge-coin-tag withdrawn">₱${log.amount} Disbursed</span>`;
}

function renderLogsTable() {
  const filtered = transactionLogs.filter(log => {
    if (activeFilter === 'ALL') return true;
    return log.event_type === activeFilter;
  });

  if (filtered.length === 0) {
    logsTableBody.innerHTML = `<tr><td colspan="7" class="table-empty">No transaction records found under this filter.</td></tr>`;
    return;
  }

  logsTableBody.innerHTML = filtered.map((log, index) => {
    const isDeposit = log.event_type === 'DEPOSIT';
    const badgeClass = isDeposit ? 'badge-deposit' : 'badge-withdrawal';
    const rowClass = index === 0 ? 'new-row' : '';
    const formattedDate = new Date(log.created_at).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const denominationHtml = formatLogDenomination(log);
    const amountPrefix = isDeposit ? '+' : '-';
    const amountText = `${amountPrefix}₱${log.amount.toLocaleString()}`;
    const snapshot = `1:[${log.count_1 ?? 0}] 5:[${log.count_5 ?? 0}] 10:[${log.count_10 ?? 0}] 20:[${log.count_20 ?? 0}]`;

    const actionCell = isDeposit 
      ? `<span class="badge-status-ok">CONFIRMED</span>`
      : `<button class="btn-receipt-view" onclick="viewReceiptById(${log.id})">
           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
           VIEW RECEIPT
         </button>`;

    return `
      <tr class="${rowClass}">
        <td>${formattedDate}</td>
        <td><span class="badge-event ${badgeClass}">${log.event_type}</span></td>
        <td>${denominationHtml}</td>
        <td style="font-weight: 800; color: ${isDeposit ? '#059669' : '#dc2626'};">${amountText}</td>
        <td><span class="snapshot-pill">${snapshot}</span></td>
        <td><strong style="color: #0f172a;">₱${(log.total_pesos || 0).toLocaleString()}</strong></td>
        <td>${actionCell}</td>
      </tr>
    `;
  }).join('');
}

// 7. Withdraw Modal & Selective Execution
const checkCoin1 = document.getElementById('checkCoin1');
const checkCoin5 = document.getElementById('checkCoin5');
const checkCoin10 = document.getElementById('checkCoin10');
const checkCoin20 = document.getElementById('checkCoin20');

const modeCoin1 = document.getElementById('modeCoin1');
const modeCoin5 = document.getElementById('modeCoin5');
const modeCoin10 = document.getElementById('modeCoin10');
const modeCoin20 = document.getElementById('modeCoin20');

const selectItem1 = document.getElementById('selectItem1');
const selectItem5 = document.getElementById('selectItem5');
const selectItem10 = document.getElementById('selectItem10');
const selectItem20 = document.getElementById('selectItem20');

const modalRemainingBalance = document.getElementById('modalRemainingBalance');

function setupWithdrawOption(denom, count, subtotal, checkEl, modeEl, itemEl, subtextId) {
  const subtextEl = document.getElementById(subtextId);
  const minCoins = 100 / denom;

  if (subtotal >= 100) {
    checkEl.disabled = false;
    modeEl.disabled = false;
    itemEl.classList.remove('disabled');
    subtextEl.textContent = `${count} coins (₱${subtotal}) • ₱100 batch (${minCoins} pcs) available`;
  } else {
    checkEl.disabled = true;
    checkEl.checked = false;
    modeEl.disabled = true;
    itemEl.classList.add('disabled');
    itemEl.classList.remove('selected');
    subtextEl.textContent = `${count} coins (₱${subtotal}) • Need ₱${100 - subtotal} more to reach ₱100`;
  }
}

function openWithdrawModal() {
  const count1 = currentContainer.count_1 || 0;
  const count5 = currentContainer.count_5 || 0;
  const count10 = currentContainer.count_10 || 0;
  const count20 = currentContainer.count_20 || 0;

  const sub1 = count1 * 1;
  const sub5 = count5 * 5;
  const sub10 = count10 * 10;
  const sub20 = count20 * 20;

  setupWithdrawOption(1, count1, sub1, checkCoin1, modeCoin1, selectItem1, 'modalSubtext1');
  setupWithdrawOption(5, count5, sub5, checkCoin5, modeCoin5, selectItem5, 'modalSubtext5');
  setupWithdrawOption(10, count10, sub10, checkCoin10, modeCoin10, selectItem10, 'modalSubtext10');
  setupWithdrawOption(20, count20, sub20, checkCoin20, modeCoin20, selectItem20, 'modalSubtext20');

  // Count how many are eligible
  const eligibleDenoms = [
    { denom: 1, eligible: sub1 >= 100, checkEl: checkCoin1 },
    { denom: 5, eligible: sub5 >= 100, checkEl: checkCoin5 },
    { denom: 10, eligible: sub10 >= 100, checkEl: checkCoin10 },
    { denom: 20, eligible: sub20 >= 100, checkEl: checkCoin20 }
  ].filter(d => d.eligible);

  // If only 1 denomination is eligible, check it by default; if multiple, let user check their preferred one
  if (eligibleDenoms.length === 1) {
    eligibleDenoms[0].checkEl.checked = true;
  } else {
    // Reset checks so user picks explicitly
    checkCoin1.checked = false;
    checkCoin5.checked = false;
    checkCoin10.checked = false;
    checkCoin20.checked = false;
  }

  recalculateWithdrawalSelection();
  withdrawModal.classList.add('active');
}

function getDenomWithdrawal(denom, count, isChecked, mode) {
  if (!isChecked || (count * denom < 100)) {
    return { amount: 0, coins: 0 };
  }
  if (mode === '100') {
    const requiredCoins = 100 / denom;
    return { amount: 100, coins: requiredCoins };
  } else {
    // 'ALL' mode
    return { amount: count * denom, coins: count };
  }
}

function recalculateWithdrawalSelection() {
  const count1 = currentContainer.count_1 || 0;
  const count5 = currentContainer.count_5 || 0;
  const count10 = currentContainer.count_10 || 0;
  const count20 = currentContainer.count_20 || 0;

  const w1 = getDenomWithdrawal(1, count1, checkCoin1.checked, modeCoin1.value);
  const w5 = getDenomWithdrawal(5, count5, checkCoin5.checked, modeCoin5.value);
  const w10 = getDenomWithdrawal(10, count10, checkCoin10.checked, modeCoin10.value);
  const w20 = getDenomWithdrawal(20, count20, checkCoin20.checked, modeCoin20.value);

  if (checkCoin1.checked) selectItem1.classList.add('selected'); else selectItem1.classList.remove('selected');
  if (checkCoin5.checked) selectItem5.classList.add('selected'); else selectItem5.classList.remove('selected');
  if (checkCoin10.checked) selectItem10.classList.add('selected'); else selectItem10.classList.remove('selected');
  if (checkCoin20.checked) selectItem20.classList.add('selected'); else selectItem20.classList.remove('selected');

  const totalWithdrawAmount = w1.amount + w5.amount + w10.amount + w20.amount;
  const totalWithdrawCoins = w1.coins + w5.coins + w10.coins + w20.coins;

  const currentTotal = currentContainer.total_pesos || (count1 * 1 + count5 * 5 + count10 * 10 + count20 * 20);
  const remainingTotal = Math.max(currentTotal - totalWithdrawAmount, 0);

  modalWithdrawAmount.textContent = `₱${totalWithdrawAmount.toLocaleString()}`;
  modalWithdrawCoins.textContent = `${totalWithdrawCoins} pcs`;
  modalRemainingBalance.textContent = `₱${remainingTotal.toLocaleString()}`;

  if (totalWithdrawAmount > 0) {
    confirmWithdrawBtn.disabled = false;
    confirmWithdrawBtn.textContent = `WITHDRAW ₱${totalWithdrawAmount.toLocaleString()} (${totalWithdrawCoins} PCS)`;
  } else {
    confirmWithdrawBtn.disabled = true;
    confirmWithdrawBtn.textContent = 'CHECK A ₱100+ COIN TO WITHDRAW';
  }
}

// Attach change listeners and row-click selection
[
  { chk: checkCoin1, item: selectItem1, mode: modeCoin1 },
  { chk: checkCoin5, item: selectItem5, mode: modeCoin5 },
  { chk: checkCoin10, item: selectItem10, mode: modeCoin10 },
  { chk: checkCoin20, item: selectItem20, mode: modeCoin20 }
].forEach(({ chk, item, mode }) => {
  chk?.addEventListener('change', recalculateWithdrawalSelection);
  mode?.addEventListener('change', recalculateWithdrawalSelection);

  // Clicking row toggles checkbox if eligible
  item?.addEventListener('click', (e) => {
    if (e.target === chk || e.target === mode || e.target.tagName === 'OPTION') return;
    if (!chk.disabled) {
      chk.checked = !chk.checked;
      recalculateWithdrawalSelection();
    }
  });
});

// ========================================================
// 8. SAFETY CONFIRMATION MODAL LOGIC (Prevents Accidental Clicks)
// ========================================================
const confirmationModal = document.getElementById('confirmationModal');
const confirmAmountText = document.getElementById('confirmAmountText');
const confirmCoinsText = document.getElementById('confirmCoinsText');
const confirmRemainingText = document.getElementById('confirmRemainingText');
const closeConfirmBtn = document.getElementById('closeConfirmBtn');
const abortConfirmBtn = document.getElementById('abortConfirmBtn');
const proceedConfirmBtn = document.getElementById('proceedConfirmBtn');

let pendingWithdrawAction = null;

function openConfirmationModal({ amount, coinsText, remaining, onConfirm }) {
  if (!confirmationModal) {
    // Fallback in case element is missing
    if (confirm(`Are you sure you want to withdraw ₱${amount} (${coinsText})?`)) {
      onConfirm();
    }
    return;
  }

  confirmAmountText.textContent = `₱${amount.toLocaleString()}`;
  confirmCoinsText.textContent = coinsText;
  confirmRemainingText.textContent = `₱${remaining.toLocaleString()}`;
  pendingWithdrawAction = onConfirm;

  confirmationModal.classList.add('active');
}

function closeConfirmationModal() {
  if (confirmationModal) {
    confirmationModal.classList.remove('active');
  }
  pendingWithdrawAction = null;
}

closeConfirmBtn?.addEventListener('click', closeConfirmationModal);
abortConfirmBtn?.addEventListener('click', closeConfirmationModal);

proceedConfirmBtn?.addEventListener('click', async () => {
  if (typeof pendingWithdrawAction === 'function') {
    const action = pendingWithdrawAction;
    closeConfirmationModal();
    await action();
  }
});

// Close when clicking outside modal box
confirmationModal?.addEventListener('click', e => {
  if (e.target === confirmationModal) {
    closeConfirmationModal();
  }
});

async function executeWithdrawal() {
  if (!supabaseClient) {
    showToast('Supabase client not initialized');
    return;
  }

  const prev1 = currentContainer.count_1 || 0;
  const prev5 = currentContainer.count_5 || 0;
  const prev10 = currentContainer.count_10 || 0;
  const prev20 = currentContainer.count_20 || 0;

  const w1 = getDenomWithdrawal(1, prev1, checkCoin1.checked, modeCoin1.value);
  const w5 = getDenomWithdrawal(5, prev5, checkCoin5.checked, modeCoin5.value);
  const w10 = getDenomWithdrawal(10, prev10, checkCoin10.checked, modeCoin10.value);
  const w20 = getDenomWithdrawal(20, prev20, checkCoin20.checked, modeCoin20.value);

  const totalWithdrawnAmount = w1.amount + w5.amount + w10.amount + w20.amount;
  const totalWithdrawnCoins = w1.coins + w5.coins + w10.coins + w20.coins;

  if (totalWithdrawnAmount === 0) {
    showToast('Please check at least one ₱100+ coin denomination to withdraw');
    return;
  }

  const remaining1 = prev1 - w1.coins;
  const remaining5 = prev5 - w5.coins;
  const remaining10 = prev10 - w10.coins;
  const remaining20 = prev20 - w20.coins;
  const remainingTotal = (remaining1 * 1) + (remaining5 * 5) + (remaining10 * 10) + (remaining20 * 20);

  const notes = withdrawNotesInput.value.trim() || 'Selective ₱100+ Batch Withdrawal';

  // Build human-readable breakdown list for safety check
  const breakdownParts = [];
  if (w1.coins > 0) breakdownParts.push(`${w1.coins} pcs (₱1)`);
  if (w5.coins > 0) breakdownParts.push(`${w5.coins} pcs (₱5)`);
  if (w10.coins > 0) breakdownParts.push(`${w10.coins} pcs (₱10)`);
  if (w20.coins > 0) breakdownParts.push(`${w20.coins} pcs (₱20)`);
  const coinsDescription = breakdownParts.join(' + ') || `${totalWithdrawnCoins} pcs`;

  // Require explicit confirmation modal to avoid accidental clicks!
  openConfirmationModal({
    amount: totalWithdrawnAmount,
    coinsText: coinsDescription,
    remaining: remainingTotal,
    onConfirm: async () => {
      confirmWithdrawBtn.disabled = true;
      confirmWithdrawBtn.textContent = 'PROCESSING...';

      try {
        const withdrawalLogData = {
          event_type: 'WITHDRAWAL',
          denomination: 0,
          amount: totalWithdrawnAmount,
          count_1: remaining1,
          count_5: remaining5,
          count_10: remaining10,
          count_20: remaining20,
          total_pesos: remainingTotal,
          notes: `${notes} [Cleared: 1x${w1.coins}, 5x${w5.coins}, 10x${w10.coins}, 20x${w20.coins}]`
        };

        // 1. Insert permanent withdrawal record in coin_logs
        const { data: insertedLog, error: logError } = await supabaseClient
          .from('coin_logs')
          .insert([withdrawalLogData])
          .select()
          .single();

        if (logError) throw logError;

        // 2. Update active coin_container counts to remaining balance
        const { error: containerError } = await supabaseClient
          .from('coin_container')
          .update({
            count_1: remaining1,
            count_5: remaining5,
            count_10: remaining10,
            count_20: remaining20,
            total_pesos: remainingTotal,
            last_action: `WITHDRAWAL_₱${totalWithdrawnAmount}`,
            updated_at: new Date().toISOString()
          })
          .eq('id', 1);

        if (containerError) throw containerError;

        showToast(`Successfully withdrawn ₱${totalWithdrawnAmount.toLocaleString()}!`);
        closeWithdrawModal();
        withdrawNotesInput.value = '';

        // Show the official receipt immediately
        openReceipt({
          id: insertedLog?.id || Date.now(),
          created_at: insertedLog?.created_at || new Date().toISOString(),
          amount: totalWithdrawnAmount,
          notes: notes,
          breakdown: {
            qty1: w1.coins,
            qty5: w5.coins,
            qty10: w10.coins,
            qty20: w20.coins
          }
        });

        fetchContainerData();
        fetchLogs();
      } catch (err) {
        console.error('Withdrawal error:', err);
        showToast('Failed to complete withdrawal');
      } finally {
        confirmWithdrawBtn.disabled = false;
        confirmWithdrawBtn.textContent = 'EXECUTE WITHDRAWAL';
      }
    }
  });
}

// 8. Official Receipt Modal Logic
const receiptModal = document.getElementById('receiptModal');
const closeReceiptBtn = document.getElementById('closeReceiptBtn');
const dismissReceiptBtn = document.getElementById('dismissReceiptBtn');
const printReceiptBtn = document.getElementById('printReceiptBtn');

function openReceipt(data) {
  const refId = `RCP-${String(data.id || '0000').padStart(6, '0')}`;
  const dateStr = new Date(data.created_at || new Date()).toLocaleString();

  document.getElementById('receiptRefId').textContent = refId;
  document.getElementById('receiptDateTime').textContent = dateStr;
  document.getElementById('receiptLogId').textContent = `#LOG-${data.id || 'N/A'}`;
  document.getElementById('receiptNotes').textContent = data.notes || 'Normal Disbursement';

  // Parse coin quantities (either from data.breakdown or extracted from notes)
  let q1 = data.breakdown?.qty1 ?? 0;
  let q5 = data.breakdown?.qty5 ?? 0;
  let q10 = data.breakdown?.qty10 ?? 0;
  let q20 = data.breakdown?.qty20 ?? 0;

  if (!data.breakdown && data.notes) {
    const match = data.notes.match(/Cleared: 1x(\d+), 5x(\d+), 10x(\d+), 20x(\d+)/) ||
                  data.notes.match(/Cleared (\d+)x₱1, (\d+)x₱5, (\d+)x₱10, (\d+)x₱20/);
    if (match) {
      q1 = parseInt(match[1]) || 0;
      q5 = parseInt(match[2]) || 0;
      q10 = parseInt(match[3]) || 0;
      q20 = parseInt(match[4]) || 0;
    }
  }

  const sub1 = q1 * 1;
  const sub5 = q5 * 5;
  const sub10 = q10 * 10;
  const sub20 = q20 * 20;
  const totalCoins = q1 + q5 + q10 + q20;
  const totalAmount = data.amount || (sub1 + sub5 + sub10 + sub20);

  document.getElementById('receiptQty1').textContent = `${q1} pcs`;
  document.getElementById('receiptSub1').textContent = `₱${sub1.toLocaleString()}`;

  document.getElementById('receiptQty5').textContent = `${q5} pcs`;
  document.getElementById('receiptSub5').textContent = `₱${sub5.toLocaleString()}`;

  document.getElementById('receiptQty10').textContent = `${q10} pcs`;
  document.getElementById('receiptSub10').textContent = `₱${sub10.toLocaleString()}`;

  document.getElementById('receiptQty20').textContent = `${q20} pcs`;
  document.getElementById('receiptSub20').textContent = `₱${sub20.toLocaleString()}`;

  document.getElementById('receiptTotalCoins').textContent = `${totalCoins} PCS`;
  document.getElementById('receiptTotalAmount').textContent = `₱${totalAmount.toLocaleString()}`;

  receiptModal.classList.add('active');
}

function closeReceiptModal() {
  receiptModal.classList.remove('active');
}

// Global viewer triggered from table buttons
window.viewReceiptById = function(logId) {
  const log = transactionLogs.find(l => l.id === logId);
  if (log) {
    openReceipt(log);
  } else {
    showToast('Receipt record not found');
  }
};

closeReceiptBtn?.addEventListener('click', closeReceiptModal);
dismissReceiptBtn?.addEventListener('click', closeReceiptModal);
printReceiptBtn?.addEventListener('click', () => {
  window.print();
});

// 8. Event Listeners & UI Controls
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderLogsTable();
  });
});

function openConfigModal() {
  configModal.classList.add('active');
}
function closeConfigModal() {
  configModal.classList.remove('active');
}

configBtn.addEventListener('click', openConfigModal);
closeConfigBtn.addEventListener('click', closeConfigModal);
cancelConfigBtn.addEventListener('click', closeConfigModal);

saveConfigBtn.addEventListener('click', () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    showToast('Please provide both URL and Key');
    return;
  }

  localStorage.setItem('SMARTCOIN_SUPABASE_URL', url);
  localStorage.setItem('SMARTCOIN_SUPABASE_KEY', key);

  closeConfigModal();
  showToast('Configuration saved. Reconnecting...');
  initSupabase();
});

function openWithdrawModal() {
  const totalCoins = (currentContainer.count_1 || 0) + (currentContainer.count_5 || 0) + (currentContainer.count_10 || 0) + (currentContainer.count_20 || 0);
  modalWithdrawAmount.textContent = `₱${currentContainer.total_pesos || 0}`;
  modalWithdrawCoins.textContent = `${totalCoins} pcs`;
  withdrawModal.classList.add('active');
}
function closeWithdrawModal() {
  withdrawModal.classList.remove('active');
}

withdrawBtn.addEventListener('click', openWithdrawModal);
closeWithdrawBtn.addEventListener('click', closeWithdrawModal);
cancelWithdrawBtn.addEventListener('click', closeWithdrawModal);
confirmWithdrawBtn.addEventListener('click', executeWithdrawal);

function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 4000);
}

// Run on page load
window.addEventListener('DOMContentLoaded', initSupabase);
