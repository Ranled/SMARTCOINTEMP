// ========================================================
// SMARTCOIN GROUP 4 - ADMIN VAULT MONITOR & AUDIT TRAIL
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

const shareBadge1 = document.getElementById('shareBadge1');
const shareBadge5 = document.getElementById('shareBadge5');
const shareBadge10 = document.getElementById('shareBadge10');
const shareBadge20 = document.getElementById('shareBadge20');

const progress1 = document.getElementById('progress1');
const progress5 = document.getElementById('progress5');
const progress10 = document.getElementById('progress10');
const progress20 = document.getElementById('progress20');

const logsTableBody = document.getElementById('logsTableBody');
const filterBtns = document.querySelectorAll('.filter-btn');

// Config Modal Elements
const configBtn = document.getElementById('configBtn');
const configModal = document.getElementById('configModal');
const closeConfigBtn = document.getElementById('closeConfigBtn');
const cancelConfigBtn = document.getElementById('cancelConfigBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const supabaseUrlInput = document.getElementById('supabaseUrlInput');
const supabaseKeyInput = document.getElementById('supabaseKeyInput');

// Reset Status Modal Elements
const resetVaultBtn = document.getElementById('resetVaultBtn');
const resetModal = document.getElementById('resetModal');
const closeResetModalBtn = document.getElementById('closeResetModalBtn');
const cancelResetModalBtn = document.getElementById('cancelResetModalBtn');
const confirmResetActionBtn = document.getElementById('confirmResetActionBtn');
const resetAmountText = document.getElementById('resetAmountText');
const resetCoinsText = document.getElementById('resetCoinsText');
const resetBreakdownText = document.getElementById('resetBreakdownText');
const resetNotesInput = document.getElementById('resetNotesInput');

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

// 3. Fetch Transaction Logs
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
    logsTableBody.innerHTML = `<tr><td colspan="7" class="table-empty">Error loading transaction logs. Check connection.</td></tr>`;
  }
}

// 4. Realtime Subscription
function subscribeToRealtime() {
  if (!supabaseClient) return;

  // Listen to changes in coin_container (Live IR deposits or Resets)
  supabaseClient
    .channel('container-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'coin_container' }, payload => {
      if (payload.new) {
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
          showToast(`💸 ₱${payload.new.amount} Cash Collected / Vault Reset!`);
        }
      }
    })
    .subscribe();
}

function detectPulse(oldData, newData) {
  if (newData.count_1 > oldData.count_1) triggerCardPulse('card-p1', 1);
  if (newData.count_5 > oldData.count_5) triggerCardPulse('card-p5', 5);
  if (newData.count_10 > oldData.count_10) triggerCardPulse('card-p10', 10);
  if (newData.count_20 > oldData.count_20) triggerCardPulse('card-p20', 20);
}

function triggerCardPulse(cardId, denomination) {
  const card = document.getElementById(cardId);
  if (!card) return;
  card.classList.remove('pulse');
  void card.offsetWidth;
  card.classList.add('pulse');

  const badge = document.createElement('div');
  badge.className = 'floating-coin-badge';
  badge.textContent = `+₱${denomination}`;
  card.appendChild(badge);
  setTimeout(() => badge.remove(), 1000);
}

// Smooth Number Counter Animation
function animateNumber(element, startVal, endVal, duration = 500, prefix = '', suffix = '') {
  if (!element) return;
  if (startVal === endVal) {
    element.textContent = `${prefix}${endVal.toLocaleString()}${suffix}`;
    return;
  }

  element.classList.remove('bump');
  void element.offsetWidth;
  element.classList.add('bump');

  const startTime = performance.now();

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
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

  // Total Vault Display
  animateNumber(totalAmountEl, prevTotalAmount, totalAmount);
  animateNumber(totalCoinsCountEl, prevTotalCoins, totalCoins, 400, '', ' PCS');

  // Coin counts
  animateNumber(count1El, prevCount1, count1);
  animateNumber(count5El, prevCount5, count5);
  animateNumber(count10El, prevCount10, count10);
  animateNumber(count20El, prevCount20, count20);

  // Subtotals
  subtotal1El.textContent = `₱${sub1.toLocaleString()}`;
  subtotal5El.textContent = `₱${sub5.toLocaleString()}`;
  subtotal10El.textContent = `₱${sub10.toLocaleString()}`;
  subtotal20El.textContent = `₱${sub20.toLocaleString()}`;

  const mins1 = count1 * 5;
  const mins5 = count5 * 30;
  const mins10 = count10 * 60;
  const mins20 = count20 * 180;
  const totalMins = mins1 + mins5 + mins10 + mins20;

  progress1.textContent = `₱${sub1.toLocaleString()} (${mins1} mins)`;
  progress5.textContent = `₱${sub5.toLocaleString()} (${mins5} mins)`;
  progress10.textContent = `₱${sub10.toLocaleString()} (${count10} hr${count10 === 1 ? '' : 's'} / ${mins10}m)`;
  progress20.textContent = `₱${sub20.toLocaleString()} (${count20 * 3} hrs / ${mins20}m)`;

  const containerStateEl = document.getElementById('containerState');
  if (containerStateEl) {
    containerStateEl.textContent = totalMins >= 60
      ? `${Math.floor(totalMins / 60)}H ${totalMins % 60}M (${totalMins} MINS)`
      : `${totalMins} MINS`;
  }

  // Share % of total vault
  const share1 = totalAmount > 0 ? Math.round((sub1 / totalAmount) * 100) : 0;
  const share5 = totalAmount > 0 ? Math.round((sub5 / totalAmount) * 100) : 0;
  const share10 = totalAmount > 0 ? Math.round((sub10 / totalAmount) * 100) : 0;
  const share20 = totalAmount > 0 ? Math.round((sub20 / totalAmount) * 100) : 0;

  bar1El.style.width = `${share1}%`;
  bar5El.style.width = `${share5}%`;
  bar10El.style.width = `${share10}%`;
  bar20El.style.width = `${share20}%`;

  shareBadge1.textContent = `${share1}% OF VAULT`;
  shareBadge5.textContent = `${share5}% OF VAULT`;
  shareBadge10.textContent = `${share10}% OF VAULT`;
  shareBadge20.textContent = `${share20}% OF VAULT`;

  // Timestamp
  if (data.updated_at) {
    const timeStr = new Date(data.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    lastUpdatedEl.textContent = `UPDATED ${timeStr}`;
  }
}

// 6. Render Transaction Logs Table
function formatLogDenomination(log) {
  if (log.event_type === 'DEPOSIT') {
    const d = Number(log.denomination || log.amount);
    const timeMap = { 1: '+5 mins', 5: '+30 mins', 10: '+1 hr', 20: '+3 hrs' };
    const timeTag = timeMap[d] || `+${d * 5} mins`;
    return `<span class="badge-coin-tag">₱${d}.00 Coin (${timeTag})</span>`;
  }

  // Check for collection / withdrawal breakdown
  if (log.notes) {
    const match = log.notes.match(/Cleared: 1x(\d+), 5x(\d+), 10x(\d+), 20x(\d+)/) ||
                  log.notes.match(/Breakdown: 1x(\d+), 5x(\d+), 10x(\d+), 20x(\d+)/);
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
    return `<span class="badge-coin-tag withdrawn">₱${log.denomination}</span>`;
  }

  return `<span class="badge-coin-tag withdrawn">Total Cash Emptied</span>`;
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
    const amountText = `${amountPrefix}₱${(log.amount || 0).toLocaleString()}`;
    const snapshot = `1:[${log.count_1 ?? 0}] 5:[${log.count_5 ?? 0}] 10:[${log.count_10 ?? 0}] 20:[${log.count_20 ?? 0}]`;
    const statusText = isDeposit ? 'CONFIRMED' : 'COLLECTED';
    const statusColor = isDeposit ? '#059669' : '#d97706';

    return `
      <tr class="${rowClass}">
        <td>${formattedDate}</td>
        <td><span class="badge-event ${badgeClass}">${isDeposit ? 'DEPOSIT' : 'COLLECTION'}</span></td>
        <td>${denominationHtml}</td>
        <td style="font-weight: 800; color: ${isDeposit ? '#059669' : '#dc2626'};">${amountText}</td>
        <td><span class="snapshot-pill">${snapshot}</span></td>
        <td><strong style="color: #0f172a;">₱${(log.total_pesos || 0).toLocaleString()}</strong></td>
        <td><span style="font-size: 0.75rem; font-weight: 700; color: ${statusColor};">${statusText}</span></td>
      </tr>
    `;
  }).join('');
}

// 7. Reset Vault Modal & Execution (Since user withdraws physically)
function openResetModal() {
  const c = currentContainer;
  const total = c.total_pesos || ((c.count_1 || 0) * 1 + (c.count_5 || 0) * 5 + (c.count_10 || 0) * 10 + (c.count_20 || 0) * 20);
  const totalCoins = (c.count_1 || 0) + (c.count_5 || 0) + (c.count_10 || 0) + (c.count_20 || 0);

  const totalMins = ((c.count_1 || 0) * 5) + ((c.count_5 || 0) * 30) + ((c.count_10 || 0) * 60) + ((c.count_20 || 0) * 180);
  const resetTimeEl = document.getElementById('resetTimeText');
  if (resetTimeEl) {
    resetTimeEl.textContent = totalMins >= 60
      ? `${totalMins} mins (${Math.floor(totalMins / 60)}h ${totalMins % 60}m)`
      : `${totalMins} mins`;
  }

  resetAmountText.textContent = `₱${total.toLocaleString()}`;
  resetCoinsText.textContent = `${totalCoins.toLocaleString()} pcs`;
  resetBreakdownText.textContent = `₱1: ${c.count_1 || 0} (5m) | ₱5: ${c.count_5 || 0} (30m) | ₱10: ${c.count_10 || 0} (1h) | ₱20: ${c.count_20 || 0} (3h)`;
  resetNotesInput.value = '';

  resetModal.classList.add('active', 'open');
}

function closeResetModal() {
  resetModal.classList.remove('active', 'open');
}

async function executeVaultReset() {
  if (!supabaseClient) {
    showToast('Database connection missing');
    return;
  }

  const c = currentContainer;
  const withdrawAmount = c.total_pesos || ((c.count_1 || 0) * 1 + (c.count_5 || 0) * 5 + (c.count_10 || 0) * 10 + (c.count_20 || 0) * 20);

  confirmResetActionBtn.disabled = true;
  confirmResetActionBtn.textContent = 'RESETTING & RECORDING...';

  const userNotes = resetNotesInput.value.trim() || 'Admin manual physical coin collection & vault counter reset';
  const fullNotes = `${userNotes} [Cleared: 1x${c.count_1 || 0}, 5x${c.count_5 || 0}, 10x${c.count_10 || 0}, 20x${c.count_20 || 0}]`;
  const nowIso = new Date().toISOString();

  try {
    // 1. Record permanent log into coin_logs
    const { error: logError } = await supabaseClient
      .from('coin_logs')
      .insert([{
        event_type: 'WITHDRAWAL',
        denomination: 0,
        amount: withdrawAmount,
        count_1: 0,
        count_5: 0,
        count_10: 0,
        count_20: 0,
        total_pesos: 0,
        notes: fullNotes
      }]);

    if (logError) throw logError;

    // 2. Reset active coin_container counter to 0 (upsert ensures row 1 exists)
    const resetPayload = {
      id: 1,
      count_1: 0,
      count_5: 0,
      count_10: 0,
      count_20: 0,
      total_pesos: 0,
      last_action: 'VAULT_MANUALLY_EMPTIED',
      updated_at: nowIso
    };

    const { error: containerError } = await supabaseClient
      .from('coin_container')
      .upsert(resetPayload, { onConflict: 'id' });

    if (containerError) throw containerError;

    updateContainerUI(resetPayload);
    showToast(`Vault counter reset to ₱0! Recorded collection of ₱${withdrawAmount.toLocaleString()}.`);
    closeResetModal();
    fetchContainerData();
    fetchLogs();
  } catch (err) {
    console.error('Vault reset error:', err);
    showToast('Failed to reset vault counter. Check database permissions.');
  } finally {
    confirmResetActionBtn.disabled = false;
    confirmResetActionBtn.textContent = 'YES, RESET STATUS TO ₱0';
  }
}
// 8. Filter Buttons
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderLogsTable();
  });
});

// 9. Config Modal Logic
function openConfigModal() { configModal.classList.add('active', 'open'); }
function closeConfigModal() { configModal.classList.remove('active', 'open'); }

configBtn.addEventListener('click', openConfigModal);
closeConfigBtn.addEventListener('click', closeConfigModal);
cancelConfigBtn.addEventListener('click', closeConfigModal);

saveConfigBtn.addEventListener('click', () => {
  const url = supabaseUrlInput.value.trim();
  const key = supabaseKeyInput.value.trim();

  if (!url || !key) {
    showToast('Please enter both Supabase URL and Anon Key');
    return;
  }

  localStorage.setItem('SMARTCOIN_SUPABASE_URL', url);
  localStorage.setItem('SMARTCOIN_SUPABASE_KEY', key);

  closeConfigModal();
  showToast('Settings saved. Connecting...');
  initSupabase();
});

// 10. Reset Modal Event Listeners
resetVaultBtn.addEventListener('click', openResetModal);
closeResetModalBtn.addEventListener('click', closeResetModal);
cancelResetModalBtn.addEventListener('click', closeResetModal);
confirmResetActionBtn.addEventListener('click', executeVaultReset);

// 11. Toast Notifications
function showToast(message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// Close modals on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeConfigModal();
    closeResetModal();
  }
});

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initSupabase();
});
