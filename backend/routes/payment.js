const express = require('express');
const Joi = require('joi');
const PayOS = require('@payos/node');
const { getDB } = require('../db');
const { authenticateToken } = require('../middleware');

const router = express.Router();

// Khởi tạo SDK PayOS
const PAYOS_CLIENT_ID = process.env.PAYOS_CLIENT_ID || 'b0d73c0a-3a2e-49d1-a60c-4729eb5ecf60';
const PAYOS_API_KEY = process.env.PAYOS_API_KEY || '0cb17d98-fd4b-48e3-9f10-40479f1b504e';
const PAYOS_CHECKSUM_KEY = process.env.PAYOS_CHECKSUM_KEY || '06590c9ee8673aebf7c219a73f3caebf202e846b995dc20f22681c6a6bb70318';

const payos = new PayOS(
    PAYOS_CLIENT_ID,
    PAYOS_API_KEY,
    PAYOS_CHECKSUM_KEY
);

const createOrderSchema = Joi.object({
    plan: Joi.string().valid('vip_weekly', 'vip_monthly', 'vip_yearly').required()
});

/**
 * Hàm hỗ trợ sinh orderCode unique cho PayOS (yêu cầu số nguyên)
 */
function generateOrderCode() {
    // Dùng timestamp + số random nhỏ để đảm bảo unique và kiểu int
    return Number(String(Date.now()).slice(-9) + Math.floor(Math.random() * 100));
}

/**
 * Tính giá trị đơn hàng theo plan
 */
function getPlanAmount(plan) {
    if (plan === 'vip_weekly') return 10000;   // Gói Tuần 10k/7 ngày
    if (plan === 'vip_monthly') return 17000;  // Gói Tháng 17k/tháng
    if (plan === 'vip_yearly') return 100000; // 100k/năm
    return 0;
}

/**
 * API #3: Tạo đơn thanh toán PayOS
 * POST /api/payment/create-vip-order (Yêu cầu JWT Token)
 */
router.post('/create-vip-order', authenticateToken, async (req, res) => {
    try {
        const { error, value } = createOrderSchema.validate(req.body);
        if (error) {
            return res.status(400).json({ error: "VALIDATION_ERROR", message: error.details[0].message });
        }

        const { plan } = value;
        const user_id = req.user_id;
        const db = getDB();
        
        // Sinh thông tin đơn hàng
        const orderCode = generateOrderCode();
        const amount = getPlanAmount(plan);
        const description = `Nang cap ${plan === 'vip_monthly' ? 'VIP thang' : 'VIP nam'}`; // Khuyến cáo tiếng Việt không dấu

        const requestData = {
            orderCode,
            amount,
            description,
            returnUrl: process.env.PAYOS_RETURN_URL,
            cancelUrl: process.env.PAYOS_CANCEL_URL
        };

        // Gọi PayOS SDK tạo link
        let paymentLinkData;
        try {
            paymentLinkData = await payos.createPaymentLink(requestData);
        } catch (payosErr) {
            console.error("Lỗi từ PayOS SDK:", payosErr);
            return res.status(502).json({ error: "PAYGATE_ERROR", message: "Không thể kết nối cổng thanh toán, vui lòng thử lại sau" });
        }

        // Lưu đơn hàng vào DB với trạng thái pending
        await db.collection('payment_orders').insertOne({
            _id: orderCode, // Dùng orderCode làm _id luôn cho tiện truy vấn
            user_id,
            amount,
            plan,
            status: "pending",
            payos_checkout_url: paymentLinkData.checkoutUrl,
            payos_qr_code: paymentLinkData.qrCode, // Giữ nguyên raw QR data
            created_at: new Date().toISOString(),
            paid_at: null
        });

        res.status(200).json({
            success: true,
            checkoutUrl: paymentLinkData.checkoutUrl,
            qrCode: paymentLinkData.qrCode,
            orderCode
        });

    } catch (err) {
        console.error("Lỗi tạo order:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi máy chủ nội bộ" });
    }
});

/**
 * API #4: Webhook nhận callback từ PayOS
 * POST /api/payment/webhook
 */
router.post('/webhook', async (req, res) => {
    try {
        const webhookData = req.body;

        // 1. Verify webhook signature bảo mật từ PayOS
        let verifiedData;
        try {
            verifiedData = payos.verifyPaymentWebhookData(webhookData);
        } catch (verifyErr) {
            console.error("Lỗi verify signature webhook:", verifyErr);
            return res.status(400).json({ error: "INVALID_SIGNATURE", message: "Chữ ký webhook không hợp lệ" });
        }

        // Nếu verify thành công, xử lý logic nâng cấp VIP
        const { orderCode, amount, code } = verifiedData; 
        // `code` của PayOS: "00" là thành công
        
        if (code !== "00") {
            // Có thể update order status = failed/cancelled tuỳ logic, ở đây trả về 200 cho PayOS khỏi retry
            return res.status(200).json({ success: true, message: "Giao dịch không thành công" });
        }

        const db = getDB();

        // 2. Lấy đơn hàng từ DB
        const order = await db.collection('payment_orders').findOne({ _id: Number(orderCode) });
        if (!order) {
            return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" });
        }

        // 3. Nếu đơn đã paid rồi thì bỏ qua (idempotent)
        if (order.status === 'paid') {
            return res.status(200).json({ success: true, message: "Webhook đã được xử lý trước đó" });
        }

        // 4. Lấy thông tin User hiện tại
        const user = await db.collection('users').findOne({ _id: order.user_id });
        if (!user) {
            return res.status(404).json({ error: "USER_NOT_FOUND", message: "Không tìm thấy user của đơn hàng" });
        }

        // 5. Tính toán hạn VIP mới
        const now = new Date();
        let currentVipExpiry = user.vip_expired_at ? new Date(user.vip_expired_at) : now;
        
        // Nếu đã hết hạn cũ, thì mốc tính là hiện tại
        if (currentVipExpiry < now) {
            currentVipExpiry = now;
        }

        let daysToAdd = 30;
        if (order.plan === 'vip_yearly') {
            daysToAdd = 365;
        } else if (order.plan === 'vip_weekly') {
            daysToAdd = 7;
        } else if (order.plan === 'vip_monthly') {
            daysToAdd = 30;
        }
        currentVipExpiry.setDate(currentVipExpiry.getDate() + daysToAdd);

        // 6. Cập nhật trạng thái
        // Update Order
        await db.collection('payment_orders').updateOne(
            { _id: order._id },
            { 
                $set: { 
                    status: "paid", 
                    paid_at: now.toISOString() 
                } 
            }
        );

        // Update User
        await db.collection('users').updateOne(
            { _id: user._id },
            { 
                $set: { 
                    membership: "vip",
                    vip_expired_at: currentVipExpiry.toISOString()
                } 
            }
        );

        console.log(`✅ [WEBHOOK] Nâng cấp VIP thành công cho user ${user._id} (Order: ${orderCode})`);
        
        // Trả về 200 OK cho hệ thống PayOS biết đã nhận thành công
        res.status(200).json({ success: true });
    } catch (err) {
        console.error("Lỗi xử lý webhook:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi nội bộ khi xử lý webhook" });
    }
});

module.exports = router;
