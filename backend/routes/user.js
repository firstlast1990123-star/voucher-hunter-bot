const express = require('express');
const { getDB } = require('../db');
const crypto = require('crypto');

const router = express.Router();

router.post('/generate-telegram-link-code', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) {
            return res.status(400).json({ success: false, error: 'Thiếu user_id' });
        }

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

router.post('/register', async (req, res) => {
    try {
        const { user_id, consent_accepted, allow_marketing } = req.body;
        if (!consent_accepted) {
            return res.status(400).json({ success: false, error: "Bạn phải đồng ý với Điều khoản sử dụng và Chính sách bảo mật." });
        }
        
        const db = getDB();
        await db.collection('users').updateOne(
            { _id: user_id },
            { 
                $set: { 
                    consent_accepted: true,
                    consent_accepted_at: new Date().toISOString(),
                    consent_version: 'v1.0',
                    allow_marketing: !!allow_marketing
                } 
            },
            { upsert: true }
        );
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, error: "Lỗi server" });
    }
});

router.get('/export-my-data', async (req, res) => {
    try {
        const user_id = req.query.user_id;
        if (!user_id) return res.status(400).json({ success: false, error: "Thiếu user_id" });
        
        const db = getDB();
        const user = await db.collection('users').findOne({ _id: user_id }) || {};
        
        // Hide internal data
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
        res.status(500).json({ success: false, error: "Lỗi server" });
    }
});

router.post('/request-deletion', async (req, res) => {
    try {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ success: false, error: "Thiếu user_id" });
        
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
        
        res.status(200).json({ success: true, message: "Yêu cầu xóa tài khoản đã được ghi nhận. Hệ thống sẽ tự động xử lý sau 7 ngày." });
    } catch (error) {
        res.status(500).json({ success: false, error: "Lỗi server" });
    }
});

module.exports = router;
