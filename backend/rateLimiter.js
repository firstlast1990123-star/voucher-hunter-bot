const rateLimit = require('express-rate-limit');

/**
 * Helper tạo rate limiter chuẩn hóa format JSON phản hồi
 */
function createLimiter(windowMs, max, customMessage) {
    return rateLimit({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        statusCode: 429,
        keyGenerator: (req) => {
            return req.ip || req.headers['x-nf-client-connection-ip'] || req.headers['client-ip'] || req.headers['x-forwarded-for'] || '127.0.0.1';
        },
        validate: false,
        message: {
            error: 'TOO_MANY_REQUESTS',
            message: customMessage || 'Bạn thao tác quá nhanh, vui lòng thử lại sau.'
        }
    });
}

// 1. Lớp bảo vệ nền chung cho toàn bộ /api/* (100 lần / 15 phút theo IP)
const globalLimiter = createLimiter(
    15 * 60 * 1000,
    100,
    'Bạn thao tác quá nhanh, vui lòng thử lại sau.'
);

// 2. /api/auth/login: 5 lần / 15 phút theo IP
const loginLimiter = createLimiter(
    15 * 60 * 1000,
    5,
    'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau 15 phút.'
);

// 3. /api/auth/register: 5 lần / 1 giờ theo IP
const registerLimiter = createLimiter(
    60 * 60 * 1000,
    5,
    'Bạn đã đăng ký quá nhiều lần trong 1 giờ. Vui lòng thử lại sau.'
);

// 4. /api/vouchers/report-broken: 10 lần / 1 giờ theo IP
const reportBrokenLimiter = createLimiter(
    60 * 60 * 1000,
    10,
    'Bạn đã báo lỗi quá nhiều lần trong 1 giờ. Vui lòng thử lại sau.'
);

// 5. /api/scan: 30 lần / 1 giờ theo IP
const scanLimiter = createLimiter(
    60 * 60 * 1000,
    30,
    'Bạn đã tra cứu link quá nhiều lần trong 1 giờ. Vui lòng thử lại sau.'
);

// 6. /api/auth/forgot-password: 3 lần / 1 giờ theo IP (chống spam email)
const forgotPasswordLimiter = createLimiter(
    60 * 60 * 1000,
    3,
    'Bạn đã yêu cầu đặt lại mật khẩu quá nhiều lần trong 1 giờ. Vui lòng thử lại sau.'
);

// 7. /api/auth/change-password: 5 lần / 15 phút theo IP (chống brute-force currentPassword)
const changePasswordLimiter = createLimiter(
    15 * 60 * 1000,
    5,
    'Bạn đã thử đổi mật khẩu quá nhiều lần. Vui lòng thử lại sau 15 phút.'
);

// 8. /api/user/request-deletion: 5 lần / 15 phút theo IP
const accountDeletionLimiter = createLimiter(
    15 * 60 * 1000,
    5,
    'Bạn đã thao tác yêu cầu xóa tài khoản quá nhiều lần. Vui lòng thử lại sau 15 phút.'
);

module.exports = {
    globalLimiter,
    loginLimiter,
    registerLimiter,
    reportBrokenLimiter,
    scanLimiter,
    forgotPasswordLimiter,
    changePasswordLimiter,
    accountDeletionLimiter,
    createLimiter
};
