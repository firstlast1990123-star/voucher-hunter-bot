// Netlify Function: Auto-Sync Vouchers from AccessTrade
// Called by frontend every 10 mins or on page load to refresh voucher data
// Filters out expired / depleted vouchers automatically

const ACCESSTRADE_API_KEY = process.env.ACCESSTRADE_API_KEY || '2IaMVbe2jWph_xuDnZNDydH2RPLYLDd0';
const ACCESSTRADE_COUPON_URL = 'https://api.accesstrade.vn/v1/offers/coupons';

// In-memory cache to avoid hammering API
let cachedVouchers = null;
let cacheTimestamp = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Classify voucher into smart category based on its data
function classifyVoucher(coupon) {
    const name = (coupon.name || coupon.title || '').toLowerCase();
    const desc = (coupon.content || coupon.description || '').toLowerCase();
    const combined = name + ' ' + desc;

    if (combined.includes('freeship') || combined.includes('vận chuyển') || combined.includes('ship') || combined.includes('giao hàng')) {
        return 'freeship';
    }
    if (combined.includes('hoàn xu') || combined.includes('xu') || combined.includes('cashback') || combined.includes('coins')) {
        return 'cashback';
    }
    if (combined.includes('%') || combined.includes('phần trăm') || combined.includes('percent')) {
        return 'percent';
    }
    if (combined.includes('thương hiệu') || combined.includes('brand') || combined.includes('mall') || combined.includes('official')) {
        return 'brand';
    }
    // Default: direct discount
    return 'direct';
}

// Pick icon based on category
function pickIcon(smartCategory) {
    const icons = {
        freeship: 'fa-solid fa-truck-fast',
        cashback: 'fa-solid fa-coins',
        percent: 'fa-solid fa-percent',
        brand: 'fa-solid fa-bag-shopping',
        direct: 'fa-solid fa-tags'
    };
    return icons[smartCategory] || 'fa-solid fa-ticket';
}

exports.handler = async (event, context) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    const now = Date.now();

    // Return cache if fresh
    if (cachedVouchers && (now - cacheTimestamp) < CACHE_TTL) {
        return {
            statusCode: 200, headers,
            body: JSON.stringify({
                success: true,
                vouchers: cachedVouchers,
                fromCache: true,
                lastSync: new Date(cacheTimestamp).toISOString(),
                nextSync: new Date(cacheTimestamp + CACHE_TTL).toISOString()
            })
        };
    }

    // Fetch fresh data from AccessTrade
    let freshVouchers = [];
    try {
        const res = await fetch(`${ACCESSTRADE_COUPON_URL}?merchant=shopee&limit=30`, {
            method: 'GET',
            headers: {
                'Authorization': `TOKEN ${ACCESSTRADE_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        const data = await res.json();

        if (data && data.data && Array.isArray(data.data)) {
            const nowDate = new Date();

            freshVouchers = data.data
                // Step 1: Filter OUT expired and depleted
                .filter(c => {
                    if (c.end_time && new Date(c.end_time) < nowDate) return false;
                    if (c.remain !== undefined && c.remain <= 0) return false;
                    return true;
                })
                // Step 2: Map to clean frontend format
                .map((c, idx) => {
                    const smartCat = classifyVoucher(c);
                    return {
                        id: `api_${c.id || idx}`,
                        type: smartCat,
                        smartCategory: smartCat,
                        category: smartCat === 'freeship' ? 'ship' : (idx % 3 === 0 ? 'vip' : 'direct'),
                        title: c.name || c.title || 'Mã Giảm Giá Shopee',
                        code: (c.coupons && c.coupons.length > 0) ? c.coupons[0].coupon_code : `SHOPEE${idx}`,
                        discountVal: c.discount || 'Khuyến Mãi',
                        minSpendAmount: c.min_amount ? Number(c.min_amount) : 0,
                        minSpend: c.min_amount ? `Đơn tối thiểu ${Number(c.min_amount).toLocaleString('vi-VN')}đ` : 'Áp dụng toàn sàn',
                        maxDiscount: c.max_discount ? `Giảm tối đa ${Number(c.max_discount).toLocaleString('vi-VN')}đ` : null,
                        startTime: c.start_time || null,
                        endTime: c.end_time || null,
                        content: c.content || c.description || '',
                        isVipOnly: idx % 3 === 0,
                        icon: pickIcon(smartCat),
                        categoryName: c.categories && c.categories.length ? c.categories[0].category_name_show : 'Toàn Sàn',
                        targetCategories: c.categories ? c.categories.map(cat => cat.category_name_show).join(', ') : 'Toàn Sàn',
                        source: 'AccessTrade',
                        remain: c.remain || null
                    };
                });
        }
    } catch (err) {
        console.warn('[auto-sync] AccessTrade fetch error:', err.message);
    }

    // Update cache
    if (freshVouchers.length > 0) {
        cachedVouchers = freshVouchers;
        cacheTimestamp = now;
    }

    return {
        statusCode: 200, headers,
        body: JSON.stringify({
            success: true,
            vouchers: freshVouchers,
            fromCache: false,
            syncedAt: new Date().toISOString(),
            totalFetched: freshVouchers.length,
            note: 'Dữ liệu mã giảm giá được tự động cập nhật từ AccessTrade API mỗi 10 phút. Mã hết hạn / hết lượt đã bị loại bỏ tự động.'
        })
    };
};
