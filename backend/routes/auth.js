const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDB } = require('../db');
const { getEffectiveMembership, getTrialRemainingSeconds } = require('../authUtils');
const { loginLimiter, registerLimiter, forgotPasswordLimiter, changePasswordLimiter } = require('../rateLimiter');
const { authenticateToken } = require('../middleware');
const { sendPasswordResetEmail } = require('../emailService');

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
            password_changed_at: null,
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
            { user_id: newUser._id, email: newUser.email, auth_time: Date.now() },
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
            { user_id: user._id, email: user.email, auth_time: Date.now() },
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
 * Tự động kiểm tra thu hồi JWT qua middleware authenticateToken
 */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const user = req.user;
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

/**
 * POST /api/auth/forgot-password
 * Yêu cầu đặt lại mật khẩu qua email
 * Rate limit: 3 lần/giờ theo IP (forgotPasswordLimiter)
 * Kèm cơ chế silent throttling chống dội bom email
 */
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
    try {
        const { email } = req.body || {};

        if (!email || !isValidEmail(email)) {
            return res.status(400).json({
                error: 'INVALID_EMAIL',
                message: 'Vui lòng nhập địa chỉ email hợp lệ.'
            });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const db = getDB();

        // 1. Tìm user theo email
        const user = await db.collection('users').findOne({ email: normalizedEmail });

        // Thông báo phản hồi chung cho cả trường hợp tìm thấy và không tìm thấy (Anti-enumeration)
        const genericSuccessResponse = {
            success: true,
            message: 'Nếu email tồn tại trong hệ thống, chúng tôi đã gửi link đặt lại mật khẩu. Vui lòng kiểm tra hộp thư đến (và mục spam).'
        };

        if (!user) {
            // Không tiết lộ sự tồn tại của email
            return res.status(200).json(genericSuccessResponse);
        }

        // 2. Chống dội bom email: Kiểm tra số lần gửi cho email này trong 1 giờ qua
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const recentCount = await db.collection('password_reset_tokens').countDocuments({
            email: normalizedEmail,
            created_at: { $gt: oneHourAgo }
        });

        if (recentCount >= 3) {
            // Đã đạt giới hạn 3 lần/giờ cho email này, trả về thông báo chung mà không gửi thêm email
            return res.status(200).json(genericSuccessResponse);
        }

        // 3. Sinh token ngẫu nhiên an toàn 32 bytes (64 ký tự hex)
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const now = new Date();
        const expiresAt = new Date(now.getTime() + 20 * 60 * 1000).toISOString(); // 20 phút

        // Vô hiệu hóa các token cũ chưa sử dụng của user này
        await db.collection('password_reset_tokens').updateMany(
            { user_id: user._id, used: false },
            { $set: { used: true, invalidated_at: now.toISOString() } }
        );

        // Lưu bản ghi băm vào DB (tuyệt đối không lưu token gốc)
        await db.collection('password_reset_tokens').insertOne({
            token_hash: tokenHash,
            user_id: user._id,
            email: normalizedEmail,
            created_at: now.toISOString(),
            expires_at: expiresAt,
            used: false,
            used_at: null
        });

        // 4. Gửi email qua Resend API
        await sendPasswordResetEmail(normalizedEmail, rawToken);

        return res.status(200).json(genericSuccessResponse);
    } catch (err) {
        console.error('Lỗi forgot-password:', err);
        return res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi hệ thống khi yêu cầu đặt lại mật khẩu.' });
    }
});

/**
 * POST /api/auth/reset-password
 * Đặt lại mật khẩu mới bằng token nhận từ email
 */
router.post('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body || {};

        if (!token || typeof token !== 'string') {
            return res.status(400).json({
                error: 'INVALID_RESET_TOKEN',
                message: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'
            });
        }

        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({
                error: 'WEAK_PASSWORD',
                message: 'Mật khẩu mới phải có tối thiểu 8 ký tự.'
            });
        }

        const db = getDB();
        const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
        const nowIso = new Date().toISOString();

        // 1. Tìm bản ghi token hợp lệ
        const resetRecord = await db.collection('password_reset_tokens').findOne({
            token_hash: tokenHash,
            used: false,
            expires_at: { $gt: nowIso }
        });

        if (!resetRecord) {
            return res.status(400).json({
                error: 'INVALID_RESET_TOKEN',
                message: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.'
            });
        }

        // 2. Băm mật khẩu mới bằng bcryptjs (salt rounds = 10)
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        const changedAt = new Date().toISOString();

        // 3. Cập nhật password_hash và password_changed_at trong users
        await db.collection('users').updateOne(
            { _id: resetRecord.user_id },
            {
                $set: {
                    password_hash: passwordHash,
                    password_changed_at: changedAt
                }
            }
        );

        // 4. Đánh dấu token đã dùng (single-use)
        await db.collection('password_reset_tokens').updateOne(
            { _id: resetRecord._id },
            {
                $set: {
                    used: true,
                    used_at: changedAt
                }
            }
        );

        return res.status(200).json({
            success: true,
            message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại bằng mật khẩu mới.'
        });
    } catch (err) {
        console.error('Lỗi reset-password:', err);
        return res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi hệ thống khi đặt lại mật khẩu.' });
    }
});

/**
 * PUT /api/auth/change-password
 * Đổi mật khẩu khi đang đăng nhập (Yêu cầu JWT Token)
 * Xác thực lại currentPassword bằng bcrypt trước khi cập nhật
 */
router.put('/change-password', authenticateToken, changePasswordLimiter, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body || {};

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                error: 'MISSING_FIELDS',
                message: 'Vui lòng nhập đầy đủ mật khẩu hiện tại và mật khẩu mới.'
            });
        }

        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({
                error: 'WEAK_PASSWORD',
                message: 'Mật khẩu mới phải có tối thiểu 8 ký tự.'
            });
        }

        if (currentPassword === newPassword) {
            return res.status(400).json({
                error: 'SAME_PASSWORD',
                message: 'Mật khẩu mới không được trùng với mật khẩu hiện tại.'
            });
        }

        const user = req.user;
        if (!user || !user.password_hash) {
            return res.status(401).json({
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy tài khoản người dùng.'
            });
        }

        // So khớp mật khẩu hiện tại bằng bcrypt
        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                error: 'INCORRECT_PASSWORD',
                message: 'Mật khẩu hiện tại không chính xác.'
            });
        }

        // Băm mật khẩu mới bằng bcryptjs
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(newPassword, salt);
        const changedAt = new Date().toISOString();

        const db = getDB();
        await db.collection('users').updateOne(
            { _id: user._id },
            {
                $set: {
                    password_hash: passwordHash,
                    password_changed_at: changedAt
                }
            }
        );

        return res.status(200).json({
            success: true,
            message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại trên các thiết bị khác.'
        });
    } catch (err) {
        console.error('Lỗi change-password:', err);
        return res.status(500).json({ error: 'SERVER_ERROR', message: 'Lỗi hệ thống khi đổi mật khẩu.' });
    }
});

module.exports = router;

