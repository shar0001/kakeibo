// =====================================================
// supabase-client.js — Supabase 認証・DB・リアルタイム
// =====================================================
'use strict';

// =====================================================
// 1. Supabase クライアント初期化
// =====================================================
let sb = null;

if (typeof SUPABASE_ENABLED !== 'undefined' && SUPABASE_ENABLED && typeof supabase !== 'undefined') {
    try {
        const { createClient } = supabase;
        sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
            auth: {
                persistSession: true,
                autoRefreshToken: true,
                detectSessionInUrl: true,
            },
            realtime: { params: { eventsPerSecond: 10 } },
        });
    } catch (e) {
        console.warn('[Supabase] 初期化失敗:', e);
    }
}

// =====================================================
// 2. 認証ヘルパー
// =====================================================
const SbAuth = {
    /** 現在のセッションを取得 */
    async getSession() {
        if (!sb) return null;
        const { data } = await sb.auth.getSession();
        return data.session;
    },

    /** 現在のユーザーを取得 */
    async getUser() {
        if (!sb) return null;
        const { data } = await sb.auth.getUser();
        return data.user;
    },

    /** 新規登録 */
    async signUp(email, password) {
        if (!sb) throw new Error('Supabase未接続');
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        return data;
    },

    /** ログイン */
    async signIn(email, password) {
        if (!sb) throw new Error('Supabase未接続');
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return data;
    },

    /** ログアウト */
    async signOut() {
        if (!sb) return;
        const { error } = await sb.auth.signOut();
        if (error) throw error;
    },

    /** 認証状態変化リスナー */
    onAuthStateChange(callback) {
        if (!sb) return { data: { subscription: { unsubscribe: () => {} } } };
        return sb.auth.onAuthStateChange((event, session) => {
            callback(event, session);
        });
    },
};

// =====================================================
// 3. 取引 CRUD
// =====================================================
const SbTransactions = {
    /** 全取引を取得（ログイン中のユーザーのみ） */
    async fetchAll() {
        if (!sb) return [];
        const { data, error } = await sb
            .from('transactions')
            .select('*')
            .order('date', { ascending: false });
        if (error) throw error;
        return data.map(dbToLocal);
    },

    /** 取引を追加 */
    async insert(txn) {
        if (!sb) return txn;
        const row = localToDb(txn);
        const { data, error } = await sb.from('transactions').insert(row).select().single();
        if (error) throw error;
        return dbToLocal(data);
    },

    /** 取引を削除 */
    async delete(id) {
        if (!sb) return;
        const { error } = await sb.from('transactions').delete().eq('id', id);
        if (error) throw error;
    },

    /** 取引を更新 */
    async update(txn) {
        if (!sb) return txn;
        const row = localToDb(txn);
        const { data, error } = await sb.from('transactions').update(row).eq('id', txn.id).select().single();
        if (error) throw error;
        return dbToLocal(data);
    },
};

// =====================================================
// 4. ユーザー設定 CRUD
// =====================================================
const SbSettings = {
    /** 設定を取得 */
    async fetch() {
        if (!sb) return null;
        const { data, error } = await sb.from('user_settings').select('*').maybeSingle();
        if (error) throw error;
        return data ? dbToLocalSettings(data) : null;
    },

    /** 設定を保存（UPSERT） */
    async upsert(settings) {
        if (!sb) return;
        const user = await SbAuth.getUser();
        if (!user) return;

        const row = {
            user_id: user.id,
            monthly_budget: settings.monthlyBudget,
            week_start: settings.weekStart,
            theme: settings.theme,
            username: settings.userName,
            expense_cats: JSON.stringify(settings.expenseCats),
            income_cats: JSON.stringify(settings.incomeCats),
            updated_at: new Date().toISOString(),
        };

        const { error } = await sb.from('user_settings').upsert(row, { onConflict: 'user_id' });
        if (error) throw error;
    },
};

// =====================================================
// 5. リアルタイム購読
// =====================================================
let realtimeChannel = null;

function subscribeRealtime(onInsert, onDelete) {
    if (!sb) return null;
    if (realtimeChannel) {
        sb.removeChannel(realtimeChannel);
    }

    realtimeChannel = sb
        .channel('kakeibo-transactions')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'transactions' },
            (payload) => {
                console.log('[Realtime] INSERT:', payload.new);
                onInsert(dbToLocal(payload.new));
            }
        )
        .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'transactions' },
            (payload) => {
                console.log('[Realtime] DELETE:', payload.old);
                onDelete(payload.old.id);
            }
        )
        .subscribe((status) => {
            console.log('[Realtime] status:', status);
        });

    return realtimeChannel;
}

function unsubscribeRealtime() {
    if (!sb) return;
    if (realtimeChannel) {
        sb.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

// =====================================================
// 6. データ変換 (DB ↔ ローカル)
// =====================================================
function localToDb(txn) {
    return {
        id: txn.id.startsWith('sample_') || txn.id.startsWith('txn_') ? undefined : txn.id,
        type: txn.type,
        amount: txn.amount,
        category: txn.category,
        category_name: txn.categoryName,
        category_icon: txn.categoryIcon,
        date: txn.date,
        memo: txn.memo || '',
        created_at: txn.createdAt || new Date().toISOString(),
    };
}

function dbToLocal(row) {
    return {
        id: row.id,
        type: row.type,
        amount: Number(row.amount),
        category: row.category,
        categoryName: row.category_name,
        categoryIcon: row.category_icon,
        date: row.date ? row.date.substring(0, 10) : '',
        memo: row.memo || '',
        createdAt: row.created_at,
    };
}

function dbToLocalSettings(row) {
    const parseSafe = (val) => {
        if (typeof val === 'object' && val !== null) return val;
        try { return JSON.parse(val); } catch (e) { return null; }
    };
    return {
        monthlyBudget: row.monthly_budget,
        weekStart: row.week_start,
        theme: row.theme,
        userName: row.username,
        expenseCats: row.expense_cats ? parseSafe(row.expense_cats) : null,
        incomeCats: row.income_cats ? parseSafe(row.income_cats) : null,
    };
}

// =====================================================
// 7. オフラインキュー
// =====================================================
const OFFLINE_QUEUE_KEY = 'kakeibo_offline_queue';

const OfflineQueue = {
    get() {
        try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]'); }
        catch { return []; }
    },
    push(item) {
        const q = this.get();
        q.push({ ...item, queuedAt: new Date().toISOString() });
        localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q));
    },
    clear() {
        localStorage.removeItem(OFFLINE_QUEUE_KEY);
    },

    /** オンライン復帰時にキューを一括送信 */
    async flush() {
        const q = this.get();
        if (q.length === 0) return;
        console.log(`[OfflineQueue] ${q.length}件を同期中...`);

        for (const item of q) {
            try {
                if (item.op === 'insert') await SbTransactions.insert(item.txn);
                if (item.op === 'delete') await SbTransactions.delete(item.id);
            } catch (e) {
                console.error('[OfflineQueue] 同期失敗:', e);
                return; // 失敗したらキューを保持
            }
        }
        this.clear();
        console.log('[OfflineQueue] 同期完了');
    },
};

// オンライン/オフライン検出
window.addEventListener('online', () => OfflineQueue.flush());
