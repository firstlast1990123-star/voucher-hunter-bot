const jwt = require('jsonwebtoken');
const { getDB } = require('./db');
const { getEffectiveMembership } = require('./authUtils');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_must_be_configured_in_env_32bytes';

/**
 * Middleware bắt buộc xác thực JWT Token
 * Áp dụng cho mọi API cần định danh user: /api/vouchers/*, /api/user/*, /api/payment/*
 */
async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

        if (!token) {
            return res.status(401).json({
                error: 'UNAUTHORIZED',
                message: 'Vui lòng đăng nhập để thực hiện thao tác này.'
            });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            return res.status(401).json({
                error: 'INVALID_TOKEN',
                message: 'Phiên đăng nhập đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'
            });
        }

        const userId = decoded ? (decoded.user_id || decoded.userId) : null;
        if (!userId) {
            return res.status(401).json({
                error: 'INVALID_TOKEN',
                message: 'Token không chứa thông tin định danh hợp lệ.'
            });
        }

        const db = getDB();
        const user = await db.collection('users').findOne({ _id: userId });

        if (!user) {
            return res.status(401).json({
                error: 'USER_NOT_FOUND',
                message: 'Tài khoản người dùng không tồn tại hoặc đã bị xóa.'
            });
        }

        // Tính membership hiệu lực qua nguồn chân lý duy nhất (có tính cả VIP Trial 2 tiếng)
        const actualMembership = getEffectiveMembership(user);

        // Gắn thông tin đã xác thực vào request
        req.user_id = user._id;
        req.user = user;
        req.userContext = {
            id: user._id,
            email: user.email,
            membership: actualMembership,
            saved_vouchers: user.saved_vouchers || []
        };

        next();
    } catch (error) {
        console.error('Lỗi middleware authenticateToken:', error);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi hệ thống khi xác thực tài khoản.' });
    }
}

/**
 * Middleware xác thực tùy chọn (Optional Authentication)
 * Dành cho các endpoint như /api/scan: Khách vãng lai vẫn dùng được (Free),
 * nhưng nếu có Token thì nhận diện user để mở khóa VIP/Trial.
 */
async function optionalAuthenticateToken(req, res, next) {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const userId = decoded ? (decoded.user_id || decoded.userId) : null;
                if (userId) {
                    const db = getDB();
                    const user = await db.collection('users').findOne({ _id: userId });
                    if (user) {
                        const actualMembership = getEffectiveMembership(user);
                        req.user_id = user._id;
                        req.user = user;
                        req.userContext = {
                            id: user._id,
                            email: user.email,
                            membership: actualMembership,
                            saved_vouchers: user.saved_vouchers || []
                        };
                    }
                }
            } catch (err) {
                // Token lỗi/hết hạn thì coi như khách vãng lai, không chặn
            }
        }

        next();
    } catch (error) {
        console.error('Lỗi optionalAuthenticateToken:', error);
        next();
    }
}

// Giữ alias checkMembership để tương thích ngược, nội bộ dùng authenticateToken
const checkMembership = authenticateToken;

module.exports = {
    authenticateToken,
    optionalAuthenticateToken,
    checkMembership
};
