const express = require('express');
const { getDB } = require('../db');

const router = express.Router();

// Mock in-memory cache để giảm tải scrape, thực tế dùng Redis
const scanCache = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 phút

/**
 * API #4: Smart Scanner
 * POST /api/scan
 */
router.post('/', async (req, res) => {
    try {
        const { shopee_link } = req.body;
        
        if (!shopee_link) {
            return res.status(400).json({ error: "MISSING_LINK", message: "Vui lòng cung cấp link Shopee" });
        }
        
        // 1. Validate link
        const shopeeRegex = /^https?:\/\/(shopee\.vn|shp\.ee|s\.shopee\.vn)\/.+/i;
        if (!shopeeRegex.test(shopee_link)) {
            return res.status(400).json({ error: "INVALID_LINK", message: "Link không hợp lệ" });
        }
        
        // 2. Parse link lấy identifier (slug)
        // Ví dụ: https://shopee.vn/Ao-Thun-Nam-i.12345.67890 -> Lấy i.12345.67890
        const urlObj = new URL(shopee_link);
        const pathSegments = urlObj.pathname.split('/');
        const slug = pathSegments[pathSegments.length - 1] || 'generic';
        
        // 3. Check cache
        const db = getDB();
        
        // Xác thực phân quyền VIP từ Database (không tin field từ client)
        let isVIP = false;
        const userId = req.body.user_id || req.query.user_id;
        if (userId) {
            const user = await db.collection('users').findOne({ _id: userId });
            if (user && user.membership === 'vip' && user.vip_expired_at) {
                const expiryDate = new Date(user.vip_expired_at);
                if (expiryDate > new Date()) {
                    isVIP = true;
                }
            }
        }

        // 3. Check cache (phân biệt cache cho VIP vs Free)
        const cacheKey = `${slug}_${isVIP ? 'vip' : 'free'}`;
        const now = Date.now();
        if (scanCache[cacheKey] && now - scanCache[cacheKey].timestamp < CACHE_TTL) {
            console.log("Trả kết quả scan từ cache cho", cacheKey);
            return res.status(200).json(scanCache[cacheKey].data);
        }
        
        // 4. Tra cứu DB live_vouchers (không scrape live để tránh rate limit)
        // Mock logic tra cứu: tìm các mã có merchant = "Shopee"
        // Thêm tính năng Early Access cho VIP (15 phút)
        const VIP_EARLY_ACCESS_MINUTES = 15;
        const nowMs = Date.now();
        const cutoffTime = new Date(nowMs - VIP_EARLY_ACCESS_MINUTES * 60000).toISOString();
        
        const query = { merchant: "Shopee", status: "live" };
        if (!isVIP) {
            query.published_at = { $lte: cutoffTime };
        }
        
        const vouchers = await db.collection('live_vouchers')
            .find(query)
            .sort({ discount_value: -1 })
            .limit(4)
            .toArray();
            
        let new_vouchers_hidden_count = 0;
        if (!isVIP) {
            new_vouchers_hidden_count = await db.collection('live_vouchers').countDocuments({
                merchant: "Shopee",
                status: "live",
                published_at: { $gt: cutoffTime }
            });
        }
            
        // 5. Chuẩn bị response
        let responseData;
        if (vouchers.length > 0) {
            responseData = { success: true, shop_name: "Shopee", vouchers, new_vouchers_hidden_count };
        } else {
            responseData = { success: true, shop_name: "Shopee", vouchers: [], new_vouchers_hidden_count, message: "Chưa tìm thấy mã giảm giá nào cho sản phẩm/shop này." };
        }
        
        // 6. Lưu cache
        scanCache[cacheKey] = { timestamp: now, data: responseData };
        
        res.status(200).json(responseData);
    } catch (err) {
        console.error("Lỗi scan link:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Có lỗi khi phân tích link" });
    }
});

module.exports = router;
