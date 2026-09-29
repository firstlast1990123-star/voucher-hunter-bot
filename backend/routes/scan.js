const express = require('express');
const { getDB } = require('../db');
const { optionalAuthenticateToken } = require('../middleware');
const { scanLimiter } = require('../rateLimiter');

const router = express.Router();

// Mock in-memory cache để giảm tải scrape, thực tế dùng Redis
const scanCache = {};
const CACHE_TTL = 30 * 60 * 1000; // 30 phút

// Regex nhận diện các domain Shopee chính thức (bao gồm link web và link rút gọn như vn.shp.ee, shp.ee, s.shopee.vn, shope.ee)
const SHOPEE_DOMAIN_REGEX = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:shopee\.(?:vn|sg|com\.my|co\.id|co\.th|ph|tw|com\.br)|shp\.ee|shope\.ee)(\/.*)?$/i;
const SHOPEE_SHORTLINK_REGEX = /^(?:[a-zA-Z0-9-]+\.)*(?:shp\.ee|shope\.ee)$|^s\.shopee\.vn$/i;
const SHOPEE_HOST_WHITELIST = /^(?:[a-zA-Z0-9-]+\.)*(?:shopee\.(?:vn|sg|com\.my|co\.id|co\.th|ph|tw|com\.br)|shp\.ee|shope\.ee)$/i;

/**
 * Tự động theo redirect (HTTP HEAD/GET) để resolve URL rút gọn Shopee về link gốc đầy đủ
 * Bảo vệ SSRF: Chỉ chấp nhận URL đích thuộc hệ sinh thái Shopee
 */
async function resolveShopeeShortlink(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        if (SHOPEE_SHORTLINK_REGEX.test(parsed.hostname)) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 6000);
            try {
                let response = await fetch(rawUrl, {
                    method: 'HEAD',
                    redirect: 'follow',
                    signal: controller.signal,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                    }
                });

                if (!response || !response.ok) {
                    response = await fetch(rawUrl, {
                        method: 'GET',
                        redirect: 'follow',
                        signal: controller.signal,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                        }
                    });
                }

                if (response && response.url) {
                    const finalParsed = new URL(response.url);
                    if (SHOPEE_HOST_WHITELIST.test(finalParsed.hostname)) {
                        return response.url;
                    }
                }
            } finally {
                clearTimeout(timeout);
            }
        }
    } catch (err) {
        console.warn('Không thể resolve redirect Shopee shortlink, giữ nguyên URL gốc:', err.message);
    }
    return rawUrl;
}

/**
 * API #4: Smart Scanner
 * POST /api/scan (Hỗ trợ cả Khách vãng lai và User đã đăng nhập, giới hạn 30 lần/giờ theo IP)
 */
router.post('/', scanLimiter, optionalAuthenticateToken, async (req, res) => {
    try {
        const { shopee_link } = req.body;
        
        if (!shopee_link) {
            return res.status(400).json({ error: "MISSING_LINK", message: "Vui lòng cung cấp link Shopee" });
        }
        
        // 1. Validate link
        if (!SHOPEE_DOMAIN_REGEX.test(shopee_link)) {
            return res.status(400).json({ error: "INVALID_LINK", message: "Link không hợp lệ" });
        }
        
        // 2. Tự động theo redirect nếu là link rút gọn
        const resolvedLink = await resolveShopeeShortlink(shopee_link);

        // 3. Parse link lấy identifier (slug)
        const urlObj = new URL(resolvedLink);
        const pathSegments = urlObj.pathname.split('/').filter(Boolean);
        const slug = pathSegments[pathSegments.length - 1] || 'generic';
        
        // 4. Check cache (phân biệt cache cho VIP vs Free)
        const db = getDB();
        const isVIP = req.userContext ? (req.userContext.membership === 'vip') : false;

        const cacheKey = `${slug}_${isVIP ? 'vip' : 'free'}`;
        const now = Date.now();
        if (scanCache[cacheKey] && now - scanCache[cacheKey].timestamp < CACHE_TTL) {
            console.log("Trả kết quả scan từ cache cho", cacheKey);
            return res.status(200).json(scanCache[cacheKey].data);
        }
        
        // 5. Tra cứu DB live_vouchers (không scrape live để tránh rate limit)
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
            
        // 6. Chuẩn bị response
        const isResolved = resolvedLink !== shopee_link;
        let responseData = {
            success: true,
            shop_name: "Shopee",
            vouchers: vouchers || [],
            new_vouchers_hidden_count,
            resolved_url: isResolved ? resolvedLink : undefined
        };
        if (vouchers.length === 0) {
            responseData.message = "Chưa tìm thấy mã giảm giá nào cho sản phẩm/shop này.";
        }
        
        // 7. Lưu cache
        scanCache[cacheKey] = { timestamp: now, data: responseData };
        
        res.status(200).json(responseData);
    } catch (err) {
        console.error("Lỗi scan link:", err);
        res.status(500).json({ error: "SERVER_ERROR", message: "Có lỗi khi phân tích link" });
    }
});

module.exports = router;
