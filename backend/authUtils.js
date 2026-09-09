/**
 * backend/authUtils.js
 * Nguồn chân lý duy nhất (Single Source of Truth) xác định quyền lợi thành viên
 */

/**
 * Xác định membership hiệu lực tại thời điểm hiện tại
 * @param {Object} user - User document từ MongoDB
 * @returns {'vip' | 'free'}
 */
function getEffectiveMembership(user) {
    if (!user) return 'free';
    const now = new Date();

    // 1. VIP thật (đã trả tiền) còn hạn — ưu tiên cao nhất
    if (user.membership === 'vip' && user.vip_expired_at) {
        const expiryDate = new Date(user.vip_expired_at);
        if (!isNaN(expiryDate.getTime()) && expiryDate > now) {
            return 'vip';
        }
    }

    // 2. VIP Trial — chỉ tính nếu chưa dùng hết lượt VÀ còn trong 2 tiếng kể từ trial_started_at
    if (!user.trial_used && user.trial_started_at) {
        const startedDate = new Date(user.trial_started_at);
        if (!isNaN(startedDate.getTime())) {
            const trialEnd = new Date(startedDate.getTime() + 2 * 60 * 60 * 1000);
            if (now < trialEnd) {
                return 'vip'; // đang trong trial, coi như VIP
            }
        }
    }

    // 3. Mặc định Free
    return 'free';
}

/**
 * Tính số giây còn lại của VIP Trial
 * @param {Object} user 
 * @returns {number} Số giây còn lại (0 nếu hết hoặc không có)
 */
function getTrialRemainingSeconds(user) {
    if (!user || user.trial_used || !user.trial_started_at) return 0;
    const startedDate = new Date(user.trial_started_at);
    if (isNaN(startedDate.getTime())) return 0;

    const trialEnd = new Date(startedDate.getTime() + 2 * 60 * 60 * 1000);
    const diff = Math.floor((trialEnd.getTime() - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
}

const VIP_PLANS = {
    vip_weekly: {
        id: 'vip_weekly',
        name: 'Gói VIP Tuần',
        days: 7,
        amount: 10000,
        description: 'VIP Tuan (7 ngay)'
    },
    vip_monthly: {
        id: 'vip_monthly',
        name: 'Gói VIP Tháng',
        days: 30,
        amount: 17000,
        description: 'VIP Thang (30 ngay)'
    }
};

/**
 * Tính toán thời hạn VIP mới (hỗ trợ cộng dồn nối tiếp nếu còn hạn)
 * @param {string|Date|null} currentExpiry - vip_expired_at hiện tại của user
 * @param {'vip_weekly'|'vip_monthly'|string} plan - Mã gói VIP
 * @param {Date} [now=new Date()] - Thời điểm hiện tại (dùng cho test)
 * @returns {Date} Thời điểm hết hạn mới
 */
function calculateVipExpiry(currentExpiry, plan, now = new Date()) {
    const nowDate = now instanceof Date ? now : new Date(now);
    let baseDate = nowDate;

    if (currentExpiry) {
        const parsedExpiry = new Date(currentExpiry);
        if (!isNaN(parsedExpiry.getTime()) && parsedExpiry > nowDate) {
            baseDate = parsedExpiry;
        }
    }

    let daysToAdd = 7; // Mặc định fallback 7 ngày (Gói Tuần / đơn cũ)
    if (plan === 'vip_monthly') {
        daysToAdd = 30;
    } else if (plan === 'vip_weekly') {
        daysToAdd = 7;
    }

    return new Date(baseDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
}

module.exports = {
    getEffectiveMembership,
    getTrialRemainingSeconds,
    VIP_PLANS,
    calculateVipExpiry
};

