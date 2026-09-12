const express = require('express');
const bcrypt = require('bcryptjs');
const { getDB } = require('../db');
const { authenticateToken } = require('../middleware');
const { accountDeletionLimiter } = require('../rateLimiter');

const router = express.Router();

/**
 * POST /api/user/generate-telegram-link-code
 * Tạo mã 6 số để liên kết tài khoản web với Telegram Bot
 * Yêu cầu JWT Token
 */
router.post('/generate-telegram-link-code', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user_id;
        const db = getDB();
        
        // Sinh mã 6 số ngẫu nhiên
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        
        // Hết hạn sau 10 phút
        const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
        
        await db.collection('telegram_link_codes').insertOne({
            _id: code,
            user_id: user_id,
            expires_at: expiresAt,
            used: false
        });

        res.status(200).json({ success: true, code, expires_in_minutes: 10 });
    } catch (error) {
        console.error("Lỗi generate telegram link code:", error);
        res.status(500).json({ success: false, error: "Lỗi server nội bộ" });
    }
});

/**
 * Legacy POST /api/user/register
 * Chuyển hướng sang /api/auth/register
 */
router.post('/register', async (req, res) => {
    res.status(400).json({
        success: false,
        error: "DEPRECATED_ENDPOINT",
        message: "Endpoint này đã lỗi thời. Vui lòng sử dụng /api/auth/register để đăng ký tài khoản với mật khẩu và email."
    });
});

/**
 * GET /api/user/export-my-data
 * Xuất dữ liệu cá nhân theo Nghị định 13 (Quyền truy cập dữ liệu)
 * Yêu cầu JWT Token
 */
router.get('/export-my-data', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user_id;
        const db = getDB();
        const user = await db.collection('users').findOne({ _id: user_id }) || {};
        
        // Ẩn thông tin nhạy cảm password_hash
        delete user.password_hash;
        
        const saved_vouchers = await db.collection('saved_vouchers').find({ user_id }).toArray();
        const telegram_subs = await db.collection('telegram_subscriptions').find({ user_id }).toArray();
        const payment_orders = await db.collection('payment_orders').find({ user_id }).toArray();
        
        const exportData = {
            profile: user,
            saved_vouchers,
            telegram_subscriptions: telegram_subs,
            payment_orders
        };
        
        res.status(200).json({ success: true, data: exportData });
    } catch (error) {
        console.error("Lỗi export-my-data:", error);
        res.status(500).json({ success: false, error: "Lỗi server" });
    }
});

/**
 * POST /api/user/request-deletion
 * Yêu cầu xóa dữ liệu cá nhân (Quyền được xóa dữ liệu theo Nghị định 13)
 * Yêu cầu JWT Token + Xác thực lại mật khẩu hiện tại
 */
router.post('/request-deletion', authenticateToken, accountDeletionLimiter, async (req, res) => {
    try {
        const { currentPassword } = req.body || {};

        if (!currentPassword || typeof currentPassword !== 'string') {
            return res.status(400).json({
                error: 'MISSING_PASSWORD',
                message: 'Vui lòng nhập mật khẩu hiện tại để xác thực yêu cầu xóa tài khoản.'
            });
        }

        const user = req.user;
        if (!user || !user.password_hash) {
            return res.status(401).json({
                error: 'USER_NOT_FOUND',
                message: 'Không tìm thấy tài khoản người dùng.'
            });
        }

        // Xác thực lại mật khẩu hiện tại bằng bcrypt (Bắt buộc cho hành động nhạy cảm)
        const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({
                error: 'INCORRECT_PASSWORD',
                message: 'Mật khẩu hiện tại không chính xác. Không thể yêu cầu xóa tài khoản.'
            });
        }

        const user_id = req.user_id;
        const db = getDB();
        await db.collection('users').updateOne(
            { _id: user_id },
            { 
                $set: { 
                    deletion_requested: true,
                    deletion_requested_at: new Date().toISOString()
                } 
            }
        );
        
        res.status(200).json({
            success: true,
            message: "Yêu cầu xóa tài khoản đã được ghi nhận. Hệ thống sẽ tự động xử lý xóa vĩnh viễn sau 7 ngày theo Nghị định 13."
        });
    } catch (error) {
        console.error("Lỗi request-deletion:", error);
        res.status(500).json({ success: false, error: "SERVER_ERROR", message: "Lỗi máy chủ nội bộ" });
    }
});

module.exports = router;
