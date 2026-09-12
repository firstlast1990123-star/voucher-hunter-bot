const express = require('express');
const Joi = require('joi');
const PayOS = require('@payos/node');
const { getDB } = require('../db');
const { authenticateToken } = require('../middleware');
const { VIP_PLANS, calculateVipExpiry } = require('../authUtils');
const { formatJoiError, parseRequestBody } = require('../validationUtils');

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

// Chỉ chấp nhận 2 gói: Gói Tuần và Gói Tháng (loại bỏ hoàn toàn vip_yearly)
// Cho phép amount trong schema nhưng bỏ qua hoàn toàn, tự tra cứu từ VIP_PLANS để chống DevTools tampering
const createOrderSchema = Joi.object({
    plan: Joi.string().valid('vip_weekly', 'vip_monthly').required(),
    amount: Joi.any().optional()
}).unknown(true);

/**
 * Hàm hỗ trợ sinh orderCode unique cho PayOS (yêu cầu số nguyên)
 */
function generateOrderCode() {
    // Dùng timestamp + số random nhỏ để đảm bảo unique và kiểu int
    return Number(String(Date.now()).slice(-9) + Math.floor(Math.random() * 100));
}

/**
 * API kiểm tra trạng thái đơn hàng PayOS
 * GET /api/payment/order-status/:orderCode (Yêu cầu JWT Token)
 */
router.get('/order-status/:orderCode', authenticateToken, async (req, res) => {
    try {
        const orderCode = Number(req.params.orderCode);
        if (!orderCode || isNaN(orderCode)) {
            return res.status(400).json({ error: "INVALID_ORDER_CODE", message: "Mã đơn hàng không hợp lệ" });
        }
        const db = getDB();
        const order = await db.collection('payment_orders').findOne({ _id: orderCode });
        if (!order) {
            return res.status(404).json({ error: "ORDER_NOT_FOUND", message: "Không tìm thấy đơn hàng" });
        }
        // Kiểm tra quyền sở hữu: User chỉ được xem đơn hàng của chính mình
        if (order.user_id !== req.user_id) {
            return res.status(403).json({ error: "FORBIDDEN", message: "Bạn không có quyền xem đơn hàng của người khác" });
        }
        return res.status(200).json({ success: true, status: order.status, plan: order.plan });
    } catch (e) {
        console.error("Lỗi lấy trạng thái order:", e);
        return res.status(500).json({ error: "SERVER_ERROR", message: "Lỗi máy chủ" });
    }
});

/**
 * API #3: Tạo đơn thanh toán PayOS
 * POST /api/payment/create-vip-order (Yêu cầu JWT Token)
 * Backend tự tra giá từ VIP_PLANS, tuyệt đối không nhận amount từ client
 */
router.post('/create-vip-order', authenticateToken, async (req, res) => {
    try {
        const body = parseRequestBody(req.body);
        const { error, value } = createOrderSchema.validate(body);
        if (error) {
            return res.status(400).json({ error: "VALIDATION_ERROR", message: formatJoiError(error) });
        }

        const { plan } = value;
        const user_id = req.user_id;
        const db = getDB();
        
        // Tra giá chuẩn từ Backend, không tin dữ liệu client gửi
        const planConfig = VIP_PLANS[plan];
        if (!planConfig) {
            return res.status(400).json({ error: "INVALID_PLAN", message: "Gói VIP không hợp lệ" });
        }

        const orderCode = generateOrderCode();
        const amount = planConfig.amount;
        const description = plan === 'vip_monthly' ? 'VIP Thang 30 ngay' : 'VIP Tuan 7 ngay';

        const requestData = {
            orderCode,
            amount,
            description,
            returnUrl: process.env.PAYOS_RETURN_URL || 'http://localhost:3000/?status=success',
            cancelUrl: process.env.PAYOS_CANCEL_URL || 'http://localhost:3000/?status=cancel'
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
 * API #4.1: Kiểm tra kết nối webhook (GET / HEAD)
 * GET /api/payment/webhook
 * PayOS hoặc dashboard ping kiểm tra endpoint trước khi cấu hình
 */
router.get('/webhook', (req, res) => {
    res.status(200).json({
        success: true,
        message: "PayOS Webhook endpoint is active"
    });
});

/**
 * API #4: Webhook nhận callback từ PayOS
 * POST /api/payment/webhook
 */
router.post('/webhook', async (req, res) => {
    try {
        const webhookData = req.body;

        // 1. Trường hợp request ping kiểm tra kết nối không mang chữ ký
        if (!webhookData || !webhookData.signature) {
            console.log("ℹ️ [WEBHOOK] Nhận request POST ping không kèm chữ ký, phản hồi 200 OK (không xử lý đơn hàng)");
            return res.status(200).json({
                success: true,
                message: "Webhook endpoint is active (ping received without signature)"
            });
        }

        // 2. Mọi request có trường signature BẮT BUỘC phải qua xác thực chữ ký số HMAC-SHA256
        let verifiedData;
        try {
            verifiedData = payos.verifyPaymentWebhookData(webhookData);
        } catch (verifyErr) {
            console.error("Lỗi verify signature webhook:", verifyErr.message);
            return res.status(400).json({ error: "INVALID_SIGNATURE", message: "Chữ ký webhook không hợp lệ" });
        }

        // Nếu verify thành công, xử lý logic nâng cấp VIP
        const { orderCode, code } = verifiedData; 

        // `code` của PayOS: "00" là thành công
        if (code !== "00") {
            // Có thể update order status = failed/cancelled tuỳ logic, ở đây trả về 200 cho PayOS khỏi retry
            return res.status(200).json({ success: true, message: "Giao dịch không thành công" });
        }

        const db = getDB();

        // 3. Lấy đơn hàng từ DB
        const order = await db.collection('payment_orders').findOne({ _id: Number(orderCode) });
        if (!order) {
            // Đơn hàng không tồn tại trong DB (ví dụ: test webhook do PayOS gửi với chữ ký hợp lệ nhưng mã đơn mẫu,
            // hoặc đơn hàng thuộc hệ thống khác dùng chung cổng).
            // Do chữ ký đã được kiểm tra an toàn, trả về 200 để PayOS xác nhận đã nhận webhook thành công.
            console.warn(`[WEBHOOK] Nhận webhook hợp lệ từ PayOS cho đơn hàng ${orderCode}, nhưng không có trong DB (đơn test hoặc hệ thống khác).`);
            return res.status(200).json({ success: true, message: "Webhook verified successfully, order not in system" });
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

        // 5. Tính toán hạn VIP mới qua nguồn chân lý duy nhất (hỗ trợ cộng dồn)
        const now = new Date();
        const newExpiry = calculateVipExpiry(user.vip_expired_at, order.plan, now);
        const resolvedPlan = (order.plan === 'vip_monthly') ? 'vip_monthly' : 'vip_weekly';

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
                    current_plan: resolvedPlan,
                    vip_expired_at: newExpiry.toISOString()
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
