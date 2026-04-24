/* =====================================================
   かけいぼ — app.js
   ===================================================== */
'use strict';

// =====================================================
// 1. 定数・デフォルトデータ
// =====================================================
const STORAGE_KEY_TXN = 'kakeibo_transactions';
const STORAGE_KEY_SETTINGS = 'kakeibo_settings';

const DEFAULT_EXPENSE_CATS = [
    { id: 'food', icon: '🍔', name: '食費' },
    { id: 'grocery', icon: '🛒', name: '日用品' },
    { id: 'transport', icon: '🚌', name: '交通費' },
    { id: 'housing', icon: '🏠', name: '住居費' },
    { id: 'medical', icon: '💊', name: '医療費' },
    { id: 'clothes', icon: '👗', name: '衣類' },
    { id: 'entertain', icon: '🎮', name: '娯楽' },
    { id: 'education', icon: '📚', name: '教育' },
    { id: 'utility', icon: '💡', name: '光熱費' },
    { id: 'telecom', icon: '📱', name: '通信費' },
    { id: 'dining', icon: '🍽️', name: '外食' },
    { id: 'car', icon: '🚗', name: '車' },
];

const DEFAULT_INCOME_CATS = [
    { id: 'salary', icon: '💰', name: '給与' },
    { id: 'side', icon: '📈', name: '副業' },
    { id: 'gift', icon: '🎁', name: '臨時収入' },
    { id: 'invest', icon: '💹', name: '投資収益' },
];

const CAT_COLORS = [
    '#4CAF82', '#4A90D9', '#FF8C42', '#9B59B6',
    '#E74C3C', '#1ABC9C', '#F39C12', '#2ECC71',
    '#3498DB', '#E91E63', '#00BCD4', '#8BC34A',
];

// =====================================================
// 2. 状態管理
// =====================================================
let state = {
    transactions: [],
    settings: {
        userName: 'ユーザー',
        monthlyBudget: 200000,
        weekStart: 'monday',
        theme: 'light',
        expenseCats: [...DEFAULT_EXPENSE_CATS],
        incomeCats: [...DEFAULT_INCOME_CATS],
    },
    currentScreen: 'home',
    homeMonth: null, // Date
    histMonth: null,
    repMonth: null,
    inputType: 'expense',
    inputAmount: '',
    inputCatId: null,
    pendingDeleteId: null,
    catManagerType: 'expense',
    editingTxnId: null,
    offlineMode: false,   // Supabase未使用時
    currentUser: null,    // Supabase User
};

// Chart.js インスタンス
let chartBudgetDonut = null;
let chartCashflow = null;
let chartExpenseDonut = null;

// =====================================================
// 3. ストレージ
// =====================================================
function loadData() {
    try {
        const txnRaw = localStorage.getItem(STORAGE_KEY_TXN);
        const setRaw = localStorage.getItem(STORAGE_KEY_SETTINGS);
        if (txnRaw) {
            let txns = JSON.parse(txnRaw);
            // 過去のサンプルデータが残っている場合は除去する
            const originalLength = txns.length;
            txns = txns.filter(t => !t.id.startsWith('sample_'));
            state.transactions = txns;
            if (txns.length !== originalLength) {
                saveTransactions(); // クリーニング済みの状態を保存
            }
        }
        if (setRaw) {
            const s = JSON.parse(setRaw);
            state.settings = { ...state.settings, ...s };
            if (!s.expenseCats) state.settings.expenseCats = [...DEFAULT_EXPENSE_CATS];
            if (!s.incomeCats) state.settings.incomeCats = [...DEFAULT_INCOME_CATS];
        }
    } catch (e) { console.error('loadData:', e); }
}

function saveTransactions() {
    localStorage.setItem(STORAGE_KEY_TXN, JSON.stringify(state.transactions));
}

function saveSettings() {
    localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify(state.settings));
    // Supabaseにも同期 (モードがオンラインの場合)
    if (!state.offlineMode) {
        SbSettings.upsert(state.settings).catch(e => console.error('settings sync:', e));
    }
}

// Supabaseから全取引をロードしlocalStorageとマージ
async function loadFromSupabase() {
    try {
        setSyncBadge('syncing');
        const [txns, settings] = await Promise.all([
            SbTransactions.fetchAll(),
            SbSettings.fetch(),
        ]);

        // 設定をマージ
        if (settings) {
            state.settings = { ...state.settings, ...settings };
            if (!settings.expenseCats) state.settings.expenseCats = [...DEFAULT_EXPENSE_CATS];
            if (!settings.incomeCats) state.settings.incomeCats = [...DEFAULT_INCOME_CATS];
            saveSettings();
        }

        // 取引をマージ (一致 id があれば上書き。サンプルデータはマージしない)
        const local = state.transactions.filter(t => t.id.startsWith('txn_'));
        const merged = [...txns];
        // ローカルの未同期分を追加
        local.forEach(lt => {
            if (!merged.find(r => r.id === lt.id)) merged.push(lt);
        });
        state.transactions = merged;
        saveTransactions();

        setSyncBadge('synced');
        console.log(`[Supabase] 読み込み完了: ${txns.length}件`);
    } catch (e) {
        console.error('[Supabase] 読み込みエラー:', e);
        setSyncBadge('offline');
    }
}

function setSyncBadge(status) {
    const badge = document.getElementById('set-sync-badge');
    if (!badge) return;
    badge.className = 'sync-badge';
    if (status === 'syncing') { badge.textContent = '↻ 同期中...'; badge.classList.add('syncing'); }
    else if (status === 'offline') { badge.textContent = '⚠️ オフライン'; badge.classList.add('offline'); }
    else { badge.textContent = '☁️ 同期済み'; }
}

// (サンプルデータの自動生成は廃止されました)

function getCatName(id, type) {
    const cats = type === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
    const cat = cats.find(c => c.id === id);
    return cat ? cat.name : id;
}
function getCatIcon(id, type) {
    const cats = type === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
    const cat = cats.find(c => c.id === id);
    return cat ? cat.icon : '🏷️';
}

// =====================================================
// 5. ユーティリティ
// =====================================================
function formatDate(date) {
    const d = date instanceof Date ? date : new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatYen(n, sign = false) {
    const abs = Math.abs(n);
    const str = `¥${Math.round(abs).toLocaleString('ja-JP')}`;
    if (!sign) return str;
    return n < 0 ? `-${str}` : `+${str}`;
}

function isSameMonth(dateStr, year, month) {
    const d = new Date(dateStr);
    return d.getFullYear() === year && d.getMonth() === month;
}

function monthLabel(date) {
    return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function getMonthTransactions(year, month) {
    return state.transactions.filter(t => isSameMonth(t.date, year, month));
}

function calcSummary(txns) {
    let income = 0, expense = 0;
    txns.forEach(t => {
        if (t.type === 'income') income += t.amount;
        else expense += t.amount;
    });
    return { income, expense, balance: income - expense };
}

function todayStr() {
    return formatDate(new Date());
}

function jpDayLabel(dateStr) {
    const d = new Date(dateStr);
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return `${d.getMonth() + 1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

function countUpAnimation(el, target, duration = 900, prefix = '¥') {
    const start = 0;
    const step = 16;
    const steps = duration / step;
    let current = 0;
    let count = 0;
    const interval = setInterval(() => {
        count++;
        current = Math.round(target * (count / steps));
        el.textContent = `${prefix}${Math.abs(current).toLocaleString('ja-JP')}`;
        if (count >= steps) {
            el.textContent = `${prefix}${Math.abs(target).toLocaleString('ja-JP')}`;
            clearInterval(interval);
        }
    }, step);
}

function showToast(msg, duration = 2000) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), duration);
}

// =====================================================
// 6. 画面遷移
// =====================================================
function navigateTo(screenId, fromFab = false) {
    if (screenId === state.currentScreen && screenId !== 'input') return;

    const prev = document.querySelector('.screen.active:not(#screen-input)');
    const next = document.getElementById(`screen-${screenId}`);

    if (!next) return;

    // input スクリーン
    if (screenId === 'input') {
        openInputScreen();
        return;
    }

    // 電卓画面が開いている状態で他の画面へ遷移する場合は電卓を閉じる
    if (screenId !== 'input') {
        const inputScreen = document.getElementById('screen-input');
        if (inputScreen && inputScreen.classList.contains('active')) {
            closeInputScreen();
        }
    }

    if (prev && prev !== next) {
        prev.classList.add('slide-out');
        setTimeout(() => prev.classList.remove('slide-out', 'active'), 300);
    }

    next.classList.add('active');
    next.classList.remove('slide-out');

    // ナビ更新
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.screen === screenId);
    });

    state.currentScreen = screenId;

    // 画面ごとのレンダリング
    if (screenId === 'home') renderHome();
    if (screenId === 'history') renderHistory();
    if (screenId === 'report') renderReport();
    if (screenId === 'settings') renderSettings();
}

function openInputScreen(txn = null) {
    const screen = document.getElementById('screen-input');
    screen.classList.add('active');
    resetInputForm(txn);
}

function closeInputScreen() {
    const screen = document.getElementById('screen-input');
    screen.classList.add('slide-out');
    setTimeout(() => screen.classList.remove('active', 'slide-out'), 350);
}

// =====================================================
// 7. ホーム画面
// =====================================================
function renderHome() {
    const y = state.homeMonth.getFullYear();
    const m = state.homeMonth.getMonth();
    const txns = getMonthTransactions(y, m);
    const { income, expense, balance } = calcSummary(txns);

    // ユーザー名・月
    document.getElementById('home-username').textContent = `${state.settings.userName}さん`;
    document.getElementById('home-month-label').textContent = monthLabel(state.homeMonth);

    // 残高
    const balEl = document.getElementById('home-balance');
    countUpAnimation(balEl, balance, 900, balance < 0 ? '-¥' : '¥');

    const incEl = document.getElementById('home-income');
    countUpAnimation(incEl, income, 700, '+¥');

    const expEl = document.getElementById('home-expense');
    countUpAnimation(expEl, expense, 700, '-¥');

    // ステータスバッジ
    const badge = document.getElementById('home-status-badge');
    badge.textContent = balance >= 0 ? '順調 ✓' : '要注意 ⚠️';
    badge.style.background = balance >= 0 ? 'var(--accent-light)' : '#FEE2E2';
    badge.style.color = balance >= 0 ? 'var(--accent)' : 'var(--accent-red)';

    // 予算ドーナツ
    const budget = state.settings.monthlyBudget;
    const used = expense;
    const remaining = Math.max(0, budget - used);
    const pct = budget > 0 ? Math.min(used / budget, 1) : 0;

    document.getElementById('budget-remaining').textContent = formatYen(remaining);
    document.getElementById('budget-limit-text').textContent = `残り / 限度額 ${formatYen(budget)}`;

    const donutColor = pct >= 1 ? '#E57373' : pct >= 0.75 ? '#FF8C42' : '#4CAF82';

    if (chartBudgetDonut) { chartBudgetDonut.destroy(); chartBudgetDonut = null; }
    const canvas1 = document.getElementById('chart-budget-donut');
    if (!canvas1 || typeof Chart === 'undefined') return; // ガード
    
    const ctx1 = canvas1.getContext('2d');
    chartBudgetDonut = new Chart(ctx1, {
        type: 'doughnut',
        data: {
            datasets: [{
                data: [used, Math.max(0, budget - used)],
                backgroundColor: [donutColor, getComputedStyle(document.documentElement).getPropertyValue('--bg-input').trim() || '#F0F4F8'],
                borderWidth: 0,
            }]
        },
        options: {
            cutout: '72%',
            animation: { animateRotate: true, duration: 1200, easing: 'easeOutQuart' },
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
        }
    });

    // カテゴリカード
    renderHomeCategoryCards(txns);

    // 最近の取引
    renderHomeRecentList(txns);
}

function renderHomeCategoryCards(txns) {
    const container = document.getElementById('home-category-scroll');
    container.innerHTML = '';

    const catMap = {};
    txns.filter(t => t.type === 'expense').forEach(t => {
        if (!catMap[t.category]) catMap[t.category] = { total: 0, count: 0, icon: t.categoryIcon, name: t.categoryName };
        catMap[t.category].total += t.amount;
        catMap[t.category].count++;
    });

    const cats = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);

    if (cats.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:13px;padding:8px;">まだ支出データがありません</p>';
        return;
    }

    cats.forEach(([id, data], i) => {
        const card = document.createElement('div');
        card.className = 'cat-card stagger-item';
        card.style.animationDelay = `${i * 0.06}s`;
        const color = CAT_COLORS[i % CAT_COLORS.length];
        card.innerHTML = `
      <div class="cat-card-icon" style="background:${color}22;">
        <span>${data.icon}</span>
      </div>
      <p class="cat-card-name">${data.name}</p>
      <p class="cat-card-count">${data.count}件</p>
    `;
        container.appendChild(card);
    });
}

function renderHomeRecentList(txns) {
    const container = document.getElementById('home-recent-list');
    container.innerHTML = '';

    const sorted = [...txns].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    if (sorted.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>取引がありません</p></div>';
        return;
    }

    sorted.forEach((t, i) => {
        const item = createTxnElement(t, i);
        container.appendChild(item);
    });
}

// =====================================================
// 8. 入力フォーム
// =====================================================
function resetInputForm(txn = null) {
    state.inputAmount = '';

    updateAmountDisplay();

    const today = todayStr();
    document.getElementById('input-date').value = txn ? txn.date : today;
    document.getElementById('input-memo').value = txn ? txn.memo : '';
    state.editingTxnId = txn ? txn.id : null;

    // タイプ切り替え
    const type = txn ? txn.type : 'expense';
    setInputType(type);

    // カテゴリ選択
    if (txn) {
        state.inputAmount = String(txn.amount);
        state.inputCatId = txn.category;
        updateAmountDisplay();
    }

    renderCatGrid();
}

function setInputType(type) {
    state.inputType = type;
    document.getElementById('toggle-expense').classList.toggle('active', type === 'expense');
    document.getElementById('toggle-income').classList.toggle('active', type === 'income');
    // タイプ切り替え時に、自動的に最初のカテゴリを選択状態にする
    const cats = type === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
    if (!state.inputCatId || !cats.find(c => c.id === state.inputCatId)) {
        state.inputCatId = cats.length > 0 ? cats[0].id : null;
    }
    renderCatGrid();
}

function renderCatGrid() {
    const grid = document.getElementById('input-cat-grid');
    grid.innerHTML = '';
    const cats = state.inputType === 'expense'
        ? state.settings.expenseCats
        : state.settings.incomeCats;

    cats.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = `cat-chip${state.inputCatId === cat.id ? ' selected' : ''}`;
        chip.dataset.catId = cat.id;
        chip.innerHTML = `
      <span class="cat-chip-icon">${cat.icon}</span>
      <span class="cat-chip-name">${cat.name}</span>
    `;
        chip.addEventListener('click', () => {
            state.inputCatId = cat.id;
            renderCatGrid();
        });
        grid.appendChild(chip);
    });
}

function updateAmountDisplay() {
    const raw = state.inputAmount || '0';
    const num = parseFloat(raw) || 0;
    document.getElementById('input-amount-display').textContent = num.toLocaleString('ja-JP');
}

function handleNumpad(val) {
    if (val === 'del') {
        state.inputAmount = state.inputAmount.slice(0, -1);
    } else {
        if (state.inputAmount === '0') state.inputAmount = '';
        state.inputAmount += val;
        // 上限 (10億円)
        if (parseFloat(state.inputAmount) > 999999999) {
            state.inputAmount = state.inputAmount.slice(0, -1);
        }
    }
    updateAmountDisplay();
}

function handleQuickAdd(val) {
    let cur = parseFloat(state.inputAmount) || 0;
    cur += val;
    if (cur > 999999999) cur = 999999999;
    state.inputAmount = String(cur);
    updateAmountDisplay();
}

async function saveTransaction() {
    const amount = parseFloat(state.inputAmount) || 0;
    if (amount <= 0) { showToast('金額を入力してください'); return; }
    if (!state.inputCatId) { showToast('カテゴリを選択してください'); return; }

    const cats = state.inputType === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
    const cat = cats.find(c => c.id === state.inputCatId) || cats[0];

    const isEdit = !!state.editingTxnId;
    const existingTxn = isEdit ? state.transactions.find(t => t.id === state.editingTxnId) : null;

    const txn = {
        id: isEdit ? state.editingTxnId : `txn_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        type: state.inputType,
        amount,
        category: cat.id,
        categoryName: cat.name,
        categoryIcon: cat.icon,
        date: document.getElementById('input-date').value,
        memo: document.getElementById('input-memo').value.trim(),
        createdAt: existingTxn ? existingTxn.createdAt : new Date().toISOString(),
    };

    // ボタンアニメーション
    const btn = document.getElementById('btn-input-save');
    btn.disabled = true;
    btn.style.transform = 'scale(0.9)';
    setTimeout(() => { btn.style.transform = ''; }, 150);

    if (!state.offlineMode) {
        try {
            setSyncBadge('syncing');
            const saved = await SbTransactions.insert(txn);
            // Supabaseが生成した UUID で上書き
            Object.assign(txn, saved);
            setSyncBadge('synced');
        } catch (e) {
            console.error('[Supabase] 保存失敗、オフラインキューに追加:', e);
            OfflineQueue.push({ op: 'insert', txn });
            setSyncBadge('offline');
        }
    } else {
        OfflineQueue.push({ op: 'insert', txn });
    }

    if (isEdit) {
        state.transactions = state.transactions.map(t => t.id === txn.id ? txn : t);
    } else {
        state.transactions.push(txn);
    }

    saveTransactions();
    state.editingTxnId = null; // リセット
    btn.disabled = false;
    showToast(isEdit ? '✅ 更新しました！' : '✅ 保存しました！');
    closeInputScreen();
    setTimeout(() => {
        if (state.currentScreen === 'hist') renderHistory();
        else renderHome();
    }, 350);
}

// =====================================================
// 9. 履歴画面
// =====================================================
function renderHistory() {
    const y = state.histMonth.getFullYear();
    const m = state.histMonth.getMonth();
    let txns = getMonthTransactions(y, m);

    document.getElementById('hist-month-label').textContent = monthLabel(state.histMonth);

    // 検索フィルター
    const q = document.getElementById('hist-search').value.trim().toLowerCase();
    if (q) {
        txns = txns.filter(t =>
            t.categoryName.toLowerCase().includes(q) ||
            t.memo.toLowerCase().includes(q)
        );
    }

    const { income, expense } = calcSummary(txns);
    document.getElementById('hist-month-sub').textContent = `支出合計: ${formatYen(expense)}`;
    document.getElementById('hist-income-total').textContent = formatYen(income);
    document.getElementById('hist-expense-total').textContent = formatYen(expense);

    // 日付グループ
    const grouped = {};
    txns.forEach(t => {
        if (!grouped[t.date]) grouped[t.date] = [];
        grouped[t.date].push(t);
    });

    const list = document.getElementById('hist-list');
    list.innerHTML = '';

    const sortedDates = Object.keys(grouped).sort((a, b) => new Date(b) - new Date(a));

    if (sortedDates.length === 0) {
        list.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><p>この月に取引はありません</p></div>';
        return;
    }

    sortedDates.forEach(dateStr => {
        const group = grouped[dateStr];
        const dayTotal = group.reduce((s, t) => t.type === 'expense' ? s - t.amount : s + t.amount, 0);

        const groupEl = document.createElement('div');
        groupEl.className = 'date-group stagger-item';

        const header = document.createElement('div');
        header.className = 'date-group-header';
        header.innerHTML = `
      <span class="dgh-date">${jpDayLabel(dateStr)}</span>
      <span class="dgh-total" style="color:${dayTotal >= 0 ? 'var(--accent)' : 'var(--accent-red)'}">
        ${dayTotal >= 0 ? '+' : ''}${formatYen(dayTotal)}
      </span>
    `;

        const items = document.createElement('div');
        items.className = 'date-group-items';

        group.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach((t, i) => {
            const item = createTxnItemWithDelete(t, i);
            items.appendChild(item);
        });

        groupEl.appendChild(header);
        groupEl.appendChild(items);
        list.appendChild(groupEl);
    });
}

function createTxnElement(t, i = 0) {
    const item = document.createElement('div');
    item.className = 'txn-item stagger-item';
    item.style.animationDelay = `${i * 0.06}s`;

    const color = getColorForCat(t.category);
    item.innerHTML = `
    <div class="txn-icon" style="background:${color}22;">${t.categoryIcon}</div>
    <div class="txn-info">
      <p class="txn-name">${t.memo || t.categoryName}</p>
      <p class="txn-cat">${t.categoryName}</p>
    </div>
    <p class="txn-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${formatYen(t.amount)}</p>
  `;
    item.addEventListener('click', () => {
        openInputScreen(t);
    });
    return item;
}

function createTxnItemWithDelete(t, i = 0) {
    const wrap = document.createElement('div');
    wrap.className = 'txn-item txn-item-long-press stagger-item';
    wrap.style.animationDelay = `${i * 0.06}s`;

    const color = getColorForCat(t.category);
    wrap.innerHTML = `
    <div class="txn-icon" style="background:${color}22;">${t.categoryIcon}</div>
    <div class="txn-info">
      <p class="txn-name">${t.memo || t.categoryName}</p>
      <p class="txn-cat">${t.categoryName}</p>
    </div>
    <p class="txn-amount ${t.type}">${t.type === 'expense' ? '-' : '+'}${formatYen(t.amount)}</p>
    <div class="delete-slide" data-id="${t.id}" role="button" aria-label="削除">🗑️</div>
  `;

    // 長押し for delete reveal
    let pressTimer = null;
    const startPress = () => {
        pressTimer = setTimeout(() => {
            wrap.classList.add('show-delete');
        }, 520);
    };
    const endPress = () => clearTimeout(pressTimer);

    wrap.addEventListener('touchstart', startPress, { passive: true });
    wrap.addEventListener('touchend', endPress);
    wrap.addEventListener('mousedown', startPress);
    wrap.addEventListener('mouseup', endPress);
    wrap.addEventListener('mouseleave', endPress);

    // outside click to hide
    document.addEventListener('click', (e) => {
        if (!wrap.contains(e.target)) wrap.classList.remove('show-delete');
    }, { passive: true });

    // delete button
    const delBtn = wrap.querySelector('.delete-slide');
    delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.pendingDeleteId = t.id;
        openModal('modal-delete');
    });

    wrap.addEventListener('click', (e) => {
        if (e.target.closest('.delete-slide')) return;
        if (wrap.classList.contains('show-delete')) return;
        openInputScreen(t);
    });

    return wrap;
}

function getColorForCat(catId) {
    const allCats = [...state.settings.expenseCats, ...state.settings.incomeCats];
    const idx = allCats.findIndex(c => c.id === catId);
    return CAT_COLORS[(idx >= 0 ? idx : 0) % CAT_COLORS.length];
}

async function deleteTransaction(id) {
    state.transactions = state.transactions.filter(t => t.id !== id);
    saveTransactions();

    if (!state.offlineMode && !id.startsWith('sample_')) {
        try {
            setSyncBadge('syncing');
            await SbTransactions.delete(id);
            setSyncBadge('synced');
        } catch (e) {
            console.error('[Supabase] 削除失敗、キューに追加:', e);
            OfflineQueue.push({ op: 'delete', id });
            setSyncBadge('offline');
        }
    }

    renderHistory();
    renderHome();
    showToast('🗑️ 削除しました');
}

// =====================================================
// 10. レポート画面
// =====================================================
function renderReport() {
    const y = state.repMonth.getFullYear();
    const m = state.repMonth.getMonth();
    const txns = getMonthTransactions(y, m);
    const { expense, income } = calcSummary(txns);

    document.getElementById('rep-month-label').textContent = monthLabel(state.repMonth);

    // 前月比
    const prevDate = new Date(y, m - 1, 1);
    const prevTxns = getMonthTransactions(prevDate.getFullYear(), prevDate.getMonth());
    const { expense: prevExp } = calcSummary(prevTxns);
    const diff = expense - prevExp;
    const pct = prevExp > 0 ? Math.round(Math.abs(diff) / prevExp * 100) : 0;

    const compMain = document.getElementById('rep-comp-main');
    const compBadge = document.getElementById('rep-comp-badge');
    if (diff <= 0) {
        compMain.textContent = `先月より${formatYen(Math.abs(diff))} 少なく使いました。素晴らしい！`;
        compBadge.textContent = `↓${pct}%`;
        compBadge.classList.remove('up');
    } else {
        compMain.textContent = `先月より${formatYen(diff)} 多く使いました。`;
        compBadge.textContent = `↑${pct}%`;
        compBadge.classList.add('up');
    }
    document.getElementById('rep-comp-total').textContent = formatYen(expense);
    document.getElementById('rep-comp-sub').textContent = `${y}年${m + 1}月の総支出`;

    // キャッシュフローバーチャート (6ヶ月)
    renderCashflowChart(y, m);

    // 支出ドーナツ
    renderExpenseDonut(txns, expense);

    // 週間内訳
    renderWeeklyBreakdown(y, m, txns);
}

function renderCashflowChart(curY, curM) {
    const labels = [], incomes = [], expenses = [];
    for (let i = -5; i <= 0; i++) {
        const d = new Date(curY, curM + i, 1);
        labels.push(`${d.getMonth() + 1}月`);
        const t = getMonthTransactions(d.getFullYear(), d.getMonth());
        const s = calcSummary(t);
        incomes.push(s.income);
        expenses.push(s.expense);
    }

    if (chartCashflow) { chartCashflow.destroy(); chartCashflow = null; }
    const ctx = document.getElementById('chart-cashflow').getContext('2d');
    chartCashflow = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    label: '収入',
                    data: incomes,
                    backgroundColor: 'rgba(76,175,130,0.75)',
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 28,
                },
                {
                    label: '支出',
                    data: expenses,
                    backgroundColor: 'rgba(229,115,115,0.75)',
                    borderRadius: 6,
                    borderSkipped: false,
                    maxBarThickness: 28,
                }
            ]
        },
        options: {
            responsive: true,
            animation: { duration: 1000, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: { label: ctx => ` ${formatYen(ctx.raw)}` }
                }
            },
            scales: {
                x: { grid: { display: false }, ticks: { color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#6B7280' } },
                y: {
                    grid: { color: getComputedStyle(document.documentElement).getPropertyValue('--border').trim() || '#E5E9EF' },
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#6B7280',
                        callback: v => v >= 10000 ? `¥${(v / 10000).toFixed(0)}万` : `¥${v.toLocaleString()}`
                    }
                }
            }
        }
    });
}

function renderExpenseDonut(txns, totalExpense) {
    const catMap = {};
    txns.filter(t => t.type === 'expense').forEach(t => {
        if (!catMap[t.category]) catMap[t.category] = { name: t.categoryName, icon: t.categoryIcon, total: 0, count: 0 };
        catMap[t.category].total += t.amount;
        catMap[t.category].count++;
    });

    const entries = Object.entries(catMap).sort((a, b) => b[1].total - a[1].total);
    const colors = entries.map((_, i) => CAT_COLORS[i % CAT_COLORS.length]);

    // カウントアップ
    const totalEl = document.getElementById('rep-donut-total');
    countUpAnimation(totalEl, totalExpense, 1000);

    if (chartExpenseDonut) { chartExpenseDonut.destroy(); chartExpenseDonut = null; }
    const ctx = document.getElementById('chart-expense-donut').getContext('2d');
    chartExpenseDonut = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: entries.map(([, v]) => v.name),
            datasets: [{
                data: entries.map(([, v]) => v.total),
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--bg-card').trim() || '#fff',
            }]
        },
        options: {
            cutout: '62%',
            animation: { animateRotate: true, duration: 1300, easing: 'easeOutQuart' },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: ctx => ` ${formatYen(ctx.raw)} (${totalExpense > 0 ? Math.round(ctx.raw / totalExpense * 100) : 0}%)` } }
            },
        }
    });

    // Legend
    const legend = document.getElementById('rep-donut-legend');
    legend.innerHTML = '';
    entries.slice(0, 6).forEach(([, v], i) => {
        const pct = totalExpense > 0 ? Math.round(v.total / totalExpense * 100) : 0;
        const row = document.createElement('div');
        row.className = 'legend-row stagger-item';
        row.innerHTML = `
      <span class="legend-color-dot" style="background:${colors[i]};"></span>
      <span class="legend-row-label">${v.name}</span>
      <span class="legend-row-amt">${formatYen(v.total)}</span>
      <span class="legend-row-pct">${pct}%</span>
    `;
        legend.appendChild(row);
    });
}

function renderWeeklyBreakdown(y, m, txns) {
    const container = document.getElementById('rep-weekly-list');
    container.innerHTML = '';

    const weekStart = state.settings.weekStart === 'monday' ? 1 : 0;
    const weeks = getWeeksOfMonth(y, m, weekStart);
    const maxAmt = Math.max(...weeks.map(w => w.total), 1);

    weeks.forEach((w, i) => {
        const pct = (w.total / maxAmt * 100).toFixed(1);
        const row = document.createElement('div');
        row.className = 'week-row stagger-item';
        row.style.animationDelay = `${i * 0.08}s`;
        row.innerHTML = `
      <span class="week-label">第${i + 1}週</span>
      <div class="week-bar-wrap">
        <div class="week-bar" data-width="${pct}"></div>
      </div>
      <span class="week-amount">${formatYen(w.total)}</span>
    `;
        container.appendChild(row);
    });

    // バーアニメーション
    requestAnimationFrame(() => {
        container.querySelectorAll('.week-bar').forEach(bar => {
            const w = bar.dataset.width;
            setTimeout(() => { bar.style.width = `${w}%`; }, 100);
        });
    });
}

function getWeeksOfMonth(y, m, weekStart) {
    const firstDay = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0);
    const weeks = [];
    let cur = new Date(firstDay);

    // weekを揃える
    while (cur.getDay() !== weekStart) cur.setDate(cur.getDate() - 1);

    while (cur <= lastDay) {
        const weekEnd = new Date(cur);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const start = new Date(Math.max(cur, firstDay));
        const end = new Date(Math.min(weekEnd, lastDay));

        const weekTxns = state.transactions.filter(t => {
            const d = new Date(t.date);
            return t.type === 'expense' && d >= start && d <= end;
        });
        weeks.push({ total: weekTxns.reduce((s, t) => s + t.amount, 0) });

        cur.setDate(cur.getDate() + 7);
        if (weeks.length >= 5) break;
    }

    return weeks.slice(0, 4);
}

// =====================================================
// 11. 設定画面
// =====================================================
function renderSettings() {
    const s = state.settings;
    document.getElementById('set-username-val').textContent = s.userName;
    document.getElementById('home-username').textContent = `${s.userName}さん`;

    // アカウント情報
    const emailEl = document.getElementById('set-account-email');
    if (emailEl) {
        if (state.offlineMode) {
            emailEl.textContent = 'オフラインモード';
        } else if (state.currentUser) {
            emailEl.textContent = state.currentUser.email;
        } else {
            emailEl.textContent = '未ログイン';
        }
    }

    // 予算
    const budget = s.monthlyBudget;
    document.getElementById('set-budget-display').textContent = formatYen(budget);

    // 当月支出
    const now = new Date();
    const txns = getMonthTransactions(now.getFullYear(), now.getMonth());
    const { expense } = calcSummary(txns);
    const pct = budget > 0 ? Math.min(expense / budget, 1) : 0;
    const bar = document.getElementById('set-budget-bar');

    bar.style.width = '0%';
    bar.classList.remove('warn', 'danger');
    if (pct >= 1) bar.classList.add('danger');
    else if (pct >= 0.75) bar.classList.add('warn');
    setTimeout(() => { bar.style.width = `${(pct * 100).toFixed(1)}%`; }, 100);

    document.getElementById('set-budget-used-text').textContent = `${formatYen(expense)} 使用済み`;
    document.getElementById('set-budget-pct').textContent = `${Math.round(pct * 100)}% 使用`;
    document.getElementById('set-budget-remain').textContent = `今月の残高は ${formatYen(Math.max(0, budget - expense))} です。`;

    // テーマ
    document.getElementById('theme-label').textContent = s.theme === 'dark' ? 'ダークモード' : 'ライトモード';

    // 週の始まり
    document.getElementById('set-week-start').value = s.weekStart;

    // カテゴリプレビュー
    const preview = document.getElementById('settings-cat-preview');
    preview.innerHTML = '';
    s.expenseCats.slice(0, 5).forEach(cat => {
        const chip = document.createElement('div');
        chip.className = 'settings-cat-chip';
        chip.innerHTML = `<span style="font-size:22px;">${cat.icon}</span><span>${cat.name}</span>`;
        preview.appendChild(chip);
    });
}

// =====================================================
// 12. モーダル制御
// =====================================================
function openModal(id) {
    document.getElementById(id).classList.add('open');
}
function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

// =====================================================
// 13. カテゴリマネージャー
// =====================================================
function openCatManager(type) {
    state.catManagerType = type;
    document.getElementById('cat-manager-title').textContent =
        type === 'expense' ? '支出カテゴリ管理' : '収入カテゴリ管理';
    renderCatManagerList();
    openModal('modal-cat-manager');
}

function renderCatManagerList() {
    const list = document.getElementById('cat-manager-list');
    list.innerHTML = '';
    const cats = state.catManagerType === 'expense'
        ? state.settings.expenseCats
        : state.settings.incomeCats;

    cats.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'cat-manager-item';
        item.innerHTML = `
      <span class="cat-manager-icon-display">${cat.icon}</span>
      <span class="cat-manager-name">${cat.name}</span>
      <button class="cat-manager-del-btn" data-id="${cat.id}">✕</button>
    `;
        item.querySelector('.cat-manager-del-btn').addEventListener('click', () => {
            if (cats.length <= 1) { showToast('カテゴリは1つ以上必要です'); return; }
            if (confirm(`本当にカテゴリ「${cat.name}」を削除しますか？\n（過去の記録からカテゴリ名は消えませんが、今後このカテゴリは使えなくなります）`)) {
                const arr = state.catManagerType === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
                const idx = arr.findIndex(c => c.id === cat.id);
                if (idx >= 0) arr.splice(idx, 1);
                saveSettings();
                renderCatManagerList();
                renderSettings();
                showToast('カテゴリを削除しました');
            }
        });
        list.appendChild(item);
    });
}

// =====================================================
// 14. テーマ切り替え
// =====================================================
function toggleTheme() {
    const isDark = state.settings.theme === 'dark';
    state.settings.theme = isDark ? 'light' : 'dark';
    saveSettings();
    applyTheme();
    renderSettings();
}

function applyTheme() {
    document.body.className = state.settings.theme === 'dark' ? 'theme-dark' : 'theme-light';
}

// =====================================================
// 16. イベント登録
// =====================================================
function bindEvents() {

    // --- BottomNav ---
    document.querySelectorAll('.nav-item[data-screen]').forEach(btn => {
        btn.addEventListener('click', () => navigateTo(btn.dataset.screen));
    });
    document.getElementById('nav-fab').addEventListener('click', () => navigateTo('input'));

    // --- ホーム ---
    document.getElementById('home-prev-month').addEventListener('click', () => {
        state.homeMonth = new Date(state.homeMonth.getFullYear(), state.homeMonth.getMonth() - 1, 1);
        renderHome();
    });
    document.getElementById('home-next-month').addEventListener('click', () => {
        state.homeMonth = new Date(state.homeMonth.getFullYear(), state.homeMonth.getMonth() + 1, 1);
        renderHome();
    });
    document.getElementById('btn-home-history').addEventListener('click', () => navigateTo('history'));
    document.getElementById('btn-home-all-cat').addEventListener('click', () => navigateTo('history'));

    // --- 入力 ---
    document.getElementById('btn-input-cancel').addEventListener('click', closeInputScreen);
    document.getElementById('btn-input-save').addEventListener('click', saveTransaction);
    document.getElementById('toggle-expense').addEventListener('click', () => setInputType('expense'));
    document.getElementById('toggle-income').addEventListener('click', () => setInputType('income'));

    document.querySelectorAll('.num-btn').forEach(btn => {
        btn.addEventListener('click', () => handleNumpad(btn.dataset.num));
    });
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => handleQuickAdd(parseInt(btn.dataset.val)));
    });

    // --- 履歴 ---
    document.getElementById('hist-prev-month').addEventListener('click', () => {
        state.histMonth = new Date(state.histMonth.getFullYear(), state.histMonth.getMonth() - 1, 1);
        renderHistory();
    });
    document.getElementById('hist-next-month').addEventListener('click', () => {
        state.histMonth = new Date(state.histMonth.getFullYear(), state.histMonth.getMonth() + 1, 1);
        renderHistory();
    });
    document.getElementById('hist-search').addEventListener('input', () => renderHistory());
    document.getElementById('btn-filter').addEventListener('click', () => {
        const chips = document.getElementById('hist-filter-chips');
        const showing = chips.style.display !== 'none';
        chips.style.display = showing ? 'none' : 'flex';
        if (!showing) renderFilterChips();
    });

    // --- レポート ---
    document.getElementById('rep-prev-month').addEventListener('click', () => {
        state.repMonth = new Date(state.repMonth.getFullYear(), state.repMonth.getMonth() - 1, 1);
        renderReport();
    });
    document.getElementById('rep-next-month').addEventListener('click', () => {
        state.repMonth = new Date(state.repMonth.getFullYear(), state.repMonth.getMonth() + 1, 1);
        renderReport();
    });
    document.getElementById('btn-rep-all-cat').addEventListener('click', () => navigateTo('history'));

    // --- 設定 ---
    document.getElementById('btn-edit-budget').addEventListener('click', () => {
        document.getElementById('modal-budget-input').value = state.settings.monthlyBudget;
        openModal('modal-budget');
    });
    document.getElementById('btn-budget-cancel').addEventListener('click', () => closeModal('modal-budget'));
    document.getElementById('btn-budget-ok').addEventListener('click', () => {
        const val = parseInt(document.getElementById('modal-budget-input').value) || 0;
        state.settings.monthlyBudget = val;
        saveSettings();
        closeModal('modal-budget');
        renderSettings();
        renderHome();
        showToast('予算を保存しました');
    });

    document.getElementById('btn-edit-username').addEventListener('click', () => {
        document.getElementById('modal-username-input').value = state.settings.userName;
        openModal('modal-username');
    });
    document.getElementById('btn-username-cancel').addEventListener('click', () => closeModal('modal-username'));
    document.getElementById('btn-username-ok').addEventListener('click', () => {
        const val = document.getElementById('modal-username-input').value.trim();
        if (!val) { showToast('名前を入力してください'); return; }
        state.settings.userName = val;
        saveSettings();
        closeModal('modal-username');
        renderSettings();
        renderHome();
        showToast('ユーザー名を変更しました');
    });

    document.getElementById('btn-theme-toggle').addEventListener('click', toggleTheme);

    document.getElementById('set-week-start').addEventListener('change', (e) => {
        state.settings.weekStart = e.target.value;
        saveSettings();
    });

    document.getElementById('btn-manage-expense-cat').addEventListener('click', () => openCatManager('expense'));
    document.getElementById('btn-manage-income-cat').addEventListener('click', () => openCatManager('income'));

    document.getElementById('btn-cat-manager-close').addEventListener('click', () => closeModal('modal-cat-manager'));
    document.getElementById('btn-cat-add').addEventListener('click', () => {
        const icon = document.getElementById('cat-manager-emoji').value.trim() || '🏷️';
        const name = document.getElementById('cat-manager-name').value.trim();
        if (!name) { showToast('カテゴリ名を入力してください'); return; }
        const arr = state.catManagerType === 'expense' ? state.settings.expenseCats : state.settings.incomeCats;
        const id = `cat_${Date.now()}`;
        arr.push({ id, icon, name });
        saveSettings();
        renderCatManagerList();
        renderSettings();
        document.getElementById('cat-manager-emoji').value = '';
        document.getElementById('cat-manager-name').value = '';
        showToast(`「${name}」を追加しました`);
    });

    // --- 削除モーダル ---
    document.getElementById('btn-delete-cancel').addEventListener('click', () => closeModal('modal-delete'));
    document.getElementById('btn-delete-ok').addEventListener('click', () => {
        if (state.pendingDeleteId) {
            deleteTransaction(state.pendingDeleteId);
            state.pendingDeleteId = null;
        }
        closeModal('modal-delete');
    });

    // --- リセットモーダル ---
    document.getElementById('btn-reset-data').addEventListener('click', () => openModal('modal-reset'));
    document.getElementById('btn-reset-cancel').addEventListener('click', () => closeModal('modal-reset'));
    document.getElementById('btn-reset-ok').addEventListener('click', async () => {
        state.transactions = [];
        saveTransactions();
        // Supabaseからも削除
        if (!state.offlineMode) {
            try {
                const all = await SbTransactions.fetchAll();
                for (const t of all) await SbTransactions.delete(t.id);
            } catch (e) { console.error('リセットエラー:', e); }
        }
        closeModal('modal-reset');
        renderHome();
        renderSettings();
        showToast('データをリセットしました');
    });

    // --- ログアウト ---
    document.getElementById('btn-logout').addEventListener('click', async () => {
        if (state.offlineMode) {
            showAuthScreen();
            return;
        }
        try {
            await SbAuth.signOut();
            unsubscribeRealtime();
            state.currentUser = null;
            state.offlineMode = false;
            showAuthScreen();
            showToast('ログアウトしました');
        } catch (e) {
            showToast('ログアウトに失敗しました');
        }
    });

    // --- ヘルプ ---
    const closeHelp = () => {
        closeModal('modal-help');
        if (!state.settings.helpShown) {
            state.settings.helpShown = true;
            saveSettings();
        }
    };
    document.getElementById('btn-notif').addEventListener('click', () => openModal('modal-help'));
    document.getElementById('btn-history-notif').addEventListener('click', () => openModal('modal-help'));
    document.getElementById('btn-show-help').addEventListener('click', () => openModal('modal-help'));
    document.getElementById('btn-help-close').addEventListener('click', closeHelp);
    document.getElementById('btn-help-ok').addEventListener('click', closeHelp);

    // モーダル背景クリックで閉じる
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });
}

// =====================================================
// 17’. 認証画面 UI
// =====================================================
function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app').style.display = 'none';
}

function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app').style.display = '';
}

function bindAuthEvents() {
    const emailEl = document.getElementById('auth-email');
    const passEl = document.getElementById('auth-password');
    const submitBtn = document.getElementById('btn-auth-submit');
    const errorEl = document.getElementById('auth-error');
    const noteEl = document.getElementById('auth-note');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const offlineBtn = document.getElementById('btn-auth-offline');

    let isSignup = false;

    const setMode = (signup) => {
        isSignup = signup;
        tabLogin.classList.toggle('active', !signup);
        tabSignup.classList.toggle('active', signup);
        submitBtn.textContent = signup ? '新規登録' : 'ログイン';
        noteEl.textContent = signup
            ? '登録後に確認メールが届きます。メールを確認してからログインしてください。'
            : 'アカウントをお持ちでない方は「新規登録」タブで登録してください。';
        errorEl.textContent = '';
    };

    tabLogin.addEventListener('click', () => setMode(false));
    tabSignup.addEventListener('click', () => setMode(true));

    submitBtn.addEventListener('click', async () => {
        const email = emailEl.value.trim();
        const pass = passEl.value;
        errorEl.textContent = '';

        if (!email || !pass) { errorEl.textContent = 'メールとパスワードを入力してください'; return; }
        if (pass.length < 6) { errorEl.textContent = 'パスワードは6文字以上入力してください'; return; }

        submitBtn.disabled = true;
        submitBtn.textContent = '处理中...';

        try {
            if (isSignup) {
                await SbAuth.signUp(email, pass);
                errorEl.style.color = 'var(--accent)';
                errorEl.textContent = '確認メールを送信しました。メールボックスを確認してログインしてください。';
            } else {
                const { user } = await SbAuth.signIn(email, pass);
                state.currentUser = user;
                await onLogin();
            }
        } catch (e) {
            errorEl.style.color = '';
            errorEl.textContent = getAuthErrorMsg(e);
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = isSignup ? '新規登録' : 'ログイン';
        }
    });

    offlineBtn.addEventListener('click', async () => {
        state.offlineMode = true;
        loadData();
        await startApp();
    });

    // Enterキーデメッセージ送信
    [emailEl, passEl].forEach(el => el.addEventListener('keydown', e => {
        if (e.key === 'Enter') submitBtn.click();
    }));
}

function getAuthErrorMsg(e) {
    const msg = e.message || '';
    if (msg.includes('Invalid login')) return 'メールまたはパスワードが正しくありません';
    if (msg.includes('Email not confirmed')) return 'メールアドレスの確認が完了していません';
    if (msg.includes('already registered')) return 'このメールアドレスは登録済みです。ログインしてください。';
    if (msg.includes('rate limit')) return '短時間に多くのリクエストがありました。しばらくお待ちください。';
    return 'エラーが発生しました: ' + msg;
}

async function onLogin() {
    loadData();
    await loadFromSupabase();
    await startApp();
    // リアルタイム購読
    subscribeRealtime(
        (newTxn) => {
            if (!state.transactions.find(t => t.id === newTxn.id)) {
                state.transactions.push(newTxn);
                saveTransactions();
                renderHome();
                if (state.currentScreen === 'history') renderHistory();
            }
        },
        (deletedId) => {
            state.transactions = state.transactions.filter(t => t.id !== deletedId);
            saveTransactions();
            renderHome();
            if (state.currentScreen === 'history') renderHistory();
        }
    );
}

async function startApp() {
    applyTheme();
    const now = new Date();
    state.homeMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.histMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    state.repMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('input-date').value = todayStr();
    showApp();
    // navigateTo('home') は state.currentScreen が既に 'home' だとスキップされるため、
    // 初回起動時にデータが表示されない問題を回避するためリセットしてから遷移する
    state.currentScreen = '';
    navigateTo('home');

    if (!state.settings.helpShown) {
        setTimeout(() => openModal('modal-help'), 400);
    }
}

function renderFilterChips() {
    const chips = document.getElementById('hist-filter-chips');
    chips.innerHTML = '';
    const allCats = [...state.settings.expenseCats, ...state.settings.incomeCats];

    const allChip = document.createElement('button');
    allChip.className = 'filter-chip active';
    allChip.textContent = 'すべて';
    allChip.addEventListener('click', () => {
        document.getElementById('hist-search').value = '';
        chips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        allChip.classList.add('active');
        renderHistory();
    });
    chips.appendChild(allChip);

    allCats.forEach(cat => {
        const chip = document.createElement('button');
        chip.className = 'filter-chip';
        chip.textContent = `${cat.icon} ${cat.name}`;
        chip.addEventListener('click', () => {
            document.getElementById('hist-search').value = cat.name;
            chips.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderHistory();
        });
        chips.appendChild(chip);
    });
}

// =====================================================
// 17. 初期化
// =====================================================
async function init() {
    applyTheme();
    bindEvents();
    bindAuthEvents();

    // ローディングオーバーレイを表示
    const overlay = document.getElementById('loading-overlay');

    // 認証状態確認
    let session = null;
    if (typeof SUPABASE_ENABLED !== 'undefined' && SUPABASE_ENABLED && typeof supabase !== 'undefined') {
        try {
            session = await SbAuth.getSession();
        } catch (e) {
            console.warn('[Auth] オフラインまたは接続不可:', e);
        }
    }

    // ローディング非表示
    overlay.classList.add('hidden');
    setTimeout(() => overlay.remove(), 500);

    if (session) {
        state.currentUser = session.user;
        await onLogin();
    } else {
        state.offlineMode = true;
        loadData();
        await startApp();
    }

    // 認証状態変化リスナー（Supabase有効時のみ）
    if (typeof SUPABASE_ENABLED !== 'undefined' && SUPABASE_ENABLED) {
        SbAuth.onAuthStateChange(async (event, newSession) => {
            if (event === 'SIGNED_IN' && newSession && !state.currentUser) {
                state.currentUser = newSession.user;
                await onLogin();
            }
            if (event === 'SIGNED_OUT') {
                state.currentUser = null;
                showAuthScreen();
            }
        });
    }
}

// DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
