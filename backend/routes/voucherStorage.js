const express = require('express');
const Joi = require('joi');
const { getDB } = require('../db');
const { authenticateToken } = require('../middleware');
const { formatJoiError, parseRequestBody } = require('../validationUtils');

const router = express.Router();

// Validate schema cho API Save (user_id được lấy bảo mật từ JWT Token)
const saveVoucherSchema = Joi.object({
    voucher_code: Joi.string().required()
});

/**
 * API #1: Lưu mã vào Kho Voucher Của Tôi
 * POST /api/vouchers/save (Yêu cầu JWT Token)
 */
router.post('/save', authenticateToken, async (req, res) => {
    try {
        const body = parseRequestBody(req.body);
        const { error, value } = saveVoucherSchema.validate(body);
        if (error) {
            return res.status(400).json({ error: "VALIDATION_ERROR", message: formatJoiError(error) });
        }

        const { voucher_code } = value;
        const db = getDB();
        const user = req.userContext;

        // 1. Kiểm tra voucher có tồn tại và hợp lệ trong live_vouchers không
        const liveVoucher = await db.collection('live_vouchers').findOne({ 
            code: voucher_code,
            status: 'live' 
        });

        if (!liveVoucher) {
            return res.status(404).json({ error: "VOUCHER_NOT_FOUND", message: "Mã giảm giá không tồn tại hoặc đã hết hạn" });
        }

        // 2. Kiểm tra voucher đã có trong kho chưa
        if (user.saved_vouchers.includes(voucher_code)) {
            return res.status(400).json({ error: "ALREADY_SAVED", message: "Mã này đã có trong kho của bạn" });
        }

        // 3. Áp dụng giới hạn Free
        if (user.membership === 'free' && user.saved_vouchers.length >= 10) {
            return res.status(403).json({ 
                error: "FREE_LIMIT_REACHED", 
                message: "Bạn đã đạt giới hạn 10 mã. Nâng cấp VIP để lưu không giới hạn." 
            });
        }

        // 4. Lưu mã
        await db.collection('users').updateOne(
            { _id: user.id },
            { 
                $push: { saved_vouchers: voucher_code }
            }
        );

        // 5. Nếu là VIP -> đưa vào priority queue
        if (user.membership === 'vip') {
            await db.collection('priority_recheck_queue').updateOne(
                { _id: voucher_code },
                { $set: { added_at: new Date().toISOString(), reason: 'vip_saved' } },
                { upsert: true }
            );
        }

        res.status(200).json({ success: true, message: "Lưu mã thành công" });
    } catch (err) {
        console.error("Lỗi lưu voucher:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi máy chủ nội bộ" });
    }
});

/**
 * API #2: Lấy danh sách Kho Voucher Của Tôi
 * GET /api/vouchers/my-storage (Yêu cầu JWT Token)
 */
router.get('/my-storage', authenticateToken, async (req, res) => {
    try {
        const db = getDB();
        const user = req.userContext;

        if (user.saved_vouchers.length === 0) {
            return res.status(200).json({ success: true, data: [] });
        }

        // Join lấy thông tin chi tiết các voucher đã lưu
        const vouchersCursor = await db.collection('live_vouchers').find({
            code: { $in: user.saved_vouchers }
        }).toArray();

        // Xử lý phân quyền hiển thị (Free limit = 10)
        const isFree = user.membership === 'free';
        
        const processedVouchers = vouchersCursor.map((v, index) => {
            if (isFree && index >= 10) {
                // Làm mờ, che giấu dữ liệu quan trọng
                return {
                    title: v.title,
                    merchant: v.merchant,
                    discount_value: v.discount_value,
                    locked: true,
                    code: "***LOCKED***",
                    landing_url: "***LOCKED***",
                    unlock_hint: "Nâng cấp VIP để xem mã này"
                };
            }
            return {
                ...v,
                locked: false
            };
        });

        // Trigger queue cho VIP
        if (!isFree && user.saved_vouchers.length > 0) {
            const bulkOps = user.saved_vouchers.map(code => ({
                updateOne: {
                    filter: { _id: code },
                    update: { $set: { added_at: new Date().toISOString(), reason: 'vip_viewing' } },
                    upsert: true
                }
            }));
            db.collection('priority_recheck_queue').bulkWrite(bulkOps).catch(e => console.error("Lỗi bulkWrite queue:", e));
        }

        res.status(200).json({ success: true, data: processedVouchers });

    } catch (err) {
        console.error("Lỗi lấy danh sách voucher:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi máy chủ nội bộ" });
    }
});

module.exports = router;
