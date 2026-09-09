const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDB } = require('../db');
const { getEffectiveMembership, getTrialRemainingSeconds } = require('../authUtils');
const { loginLimiter, registerLimiter } = require('../rateLimiter');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_must_be_configured_in_env_32bytes';

/**
 * Validate định dạng email đơn giản
 */
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return typeof email === 'string' && re.test(email.trim());
}

/**
 * POST /api/auth/register
 * Đăng ký tài khoản mới kèm đồng ý Nghị định 13
 * Giới hạn 5 lần/giờ theo IP để chống tạo tài khoản ảo hàng loạt
 */
router.post('/register', registerLimiter, async (req, res) => {
    try {
        const { email, password, consent_accepted, allow_marketing } = req.body;

        // 1. Validate đầu vào
        if (!email || !isValidEmail(email)) {
            return res.status(400).json({ error: 'INVALID_EMAIL', message: 'Email không đúng định dạng.' });
        }

        if (!password || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Mật khẩu phải có tối thiểu 8 ký tự.' });
        }

        if (consent_accepted !== true) {
            return res.status(400).json({
                error: 'CONSENT_REQUIRED',
                message: 'Bạn phải đọc và đồng ý với Điều khoản sử dụng và Chính sách bảo mật (Nghị định 13).'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const db = getDB();

        // 2. Kiểm tra email đã tồn tại chưa (Unique)
        const existingUser = await db.collection('users').findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email này đã được đăng ký tài khoản.' });
        }

        // 3. Hash mật khẩu bằng bcryptjs (salt rounds = 10)
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        // 4. Tạo User document mới với VIP Trial 2 tiếng
        const now = new Date().toISOString();
        const userId = 'user_' + crypto.randomBytes(8).toString('hex');

        const newUser = {
            _id: userId,
            email: normalizedEmail,
            password_hash: passwordHash,
            membership: 'free',
            vip_expired_at: null,
            created_at: now,
            trial_started_at: now,
            trial_used: false,
            saved_vouchers: [],
            consent_accepted: true,
            consent_accepted_at: now,
            consent_version: 'v1.0',
            allow_marketing: !!allow_marketing
        };

        await db.collection('users').insertOne(newUser);

        // 5. Tạo JWT token
        const token = jwt.sign(
            { user_id: newUser._id, email: newUser.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const effectiveMembership = getEffectiveMembership(newUser);

        res.status(201).json({
            success: true,
            token,
            user: {
                id: newUser._id,
                email: newUser.email,
                membership: effectiveMembership,
                current_plan: newUser.current_plan || null,
                is_trial: effectiveMembership === 'vip' && !newUser.vip_expired_at,
                trial_remaining_seconds: getTrialRemainingSeconds(newUser)
            }
        });
    } catch (err) {
        console.error('Lỗi đăng ký:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Có lỗi xảy ra khi tạo tài khoản.' });
    }
});

/**
 * POST /api/auth/login
 * Đăng nhập có rate-limit chống brute-force
 */
router.post('/login', loginLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'MISSING_CREDENTIALS', message: 'Vui lòng nhập đầy đủ email và mật khẩu.' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const db = getDB();

        // 1. Tìm user
        const user = await db.collection('users').findOne({ email: normalizedEmail });
        if (!user || !user.password_hash) {
            // Trả lỗi chung chung để chống enumeration email
            return res.status(401).json({ error: 'AUTH_FAILED', message: 'Email hoặc mật khẩu không đúng.' });
        }

        // 2. So khớp password hash
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'AUTH_FAILED', message: 'Email hoặc mật khẩu không đúng.' });
        }

        // 3. Tạo JWT token
        const token = jwt.sign(
            { user_id: user._id, email: user.email },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        const effectiveMembership = getEffectiveMembership(user);

        res.status(200).json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                membership: effectiveMembership,
                current_plan: user.current_plan || null,
                is_trial: effectiveMembership === 'vip' && !user.vip_expired_at,
                trial_remaining_seconds: getTrialRemainingSeconds(user),
                vip_expired_at: user.vip_expired_at
            }
        });
    } catch (err) {
        console.error('Lỗi đăng nhập:', err);
        res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi hệ thống khi đăng nhập.' });
    }
});

/**
 * GET /api/auth/me
 * Lấy thông tin user hiện tại (yêu cầu Authorization: Bearer <token>)
 */
router.get('/me', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

        if (!token) {
            return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Chưa đăng nhập.' });
        }

        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (e) {
            return res.status(401).json({ error: 'INVALID_TOKEN', message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.' });
        }

        const db = getDB();
        const user = await db.collection('users').findOne({ _id: decoded.user_id });
        if (!user) {
            return res.status(401).json({ error: 'USER_NOT_FOUND', message: 'Tài khoản không tồn tại.' });
        }

        const effectiveMembership = getEffectiveMembership(user);

        res.status(200).json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                membership: effectiveMembership,
                current_plan: user.current_plan || null,
                is_trial: effectiveMembership === 'vip' && !user.vip_expired_at,
                trial_remaining_seconds: getTrialRemainingSeconds(user),
                vip_expired_at: user.vip_expired_at
            }
        });
    } catch (err) {
        console.error('Lỗi auth/me:', err);
        res.status(500).json({ error: 'SERVER_ERROR' });
    }
});

module.exports = router;

