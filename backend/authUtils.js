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

module.exports = {
    getEffectiveMembership,
    getTrialRemainingSeconds
};

