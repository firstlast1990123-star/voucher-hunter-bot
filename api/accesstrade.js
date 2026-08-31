// Netlify Function: AccessTrade API Integration
// AccessTrade Authorization Token: 2IaMVbe2jWph_xuDnZNDydH2RPLYLDd0

const ACCESSTRADE_API_KEY = process.env.ACCESSTRADE_API_KEY || '2IaMVbe2jWph_xuDnZNDydH2RPLYLDd0';
const ACCESSTRADE_DEEPLINK_URL = 'https://api.accesstrade.vn/v1/deeplinks/create';
const ACCESSTRADE_COUPON_URL = 'https://api.accesstrade.vn/v1/offers/coupons';

const handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    let reqBody = {};
    if (event.body) {
      try {
        reqBody = JSON.parse(event.body);
      } catch (e) {}
    }

    const originalUrl = reqBody.shopeeUrl || reqBody.url || 'https://shopee.vn';

    // -----------------------------------------------------------------------
    // Step A & B: Call AccessTrade Deeplink API & Coupons API
    // -----------------------------------------------------------------------
    let affiliateUrl = originalUrl;
    let isAffiliateConverted = false;
    let fetchedVouchers = [];

    // Attempt AccessTrade Deeplink conversion
    try {
      const deeplinkRes = await fetch(ACCESSTRADE_DEEPLINK_URL, {
        method: 'POST',
        headers: {
          'Authorization': `TOKEN ${ACCESSTRADE_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          urls: [originalUrl]
        })
      });

      const deeplinkData = await deeplinkRes.json();

      if (deeplinkData && deeplinkData.result && deeplinkData.result.data && deeplinkData.result.data[0]) {
        const item = deeplinkData.result.data[0];
        affiliateUrl = item.short_link || item.product_link || item.aff_link || originalUrl;
        isAffiliateConverted = true;
      }
    } catch (deeplinkErr) {
      console.warn('[AccessTrade] Deeplink API warning:', deeplinkErr.message);
    }

    // Fallback affiliate link generation if API response is empty/rate limited
    if (!isAffiliateConverted && originalUrl.includes('shopee.vn')) {
      const encoded = encodeURIComponent(originalUrl);
      affiliateUrl = `https://go.isclix.com/deep_link/4348614524458319985/4751584426685816997?url=${encoded}`;
    }

    // Ensure affiliateUrl is absolute to prevent client 404 domain prepending
    if (!affiliateUrl.startsWith('http://') && !affiliateUrl.startsWith('https://')) {
      affiliateUrl = 'https://' + affiliateUrl;
    }
    try {
      const couponRes = await fetch(`${ACCESSTRADE_COUPON_URL}?merchant=shopee&limit=10`, {
        method: 'GET',
        headers: {
          'Authorization': `TOKEN ${ACCESSTRADE_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
      const couponData = await couponRes.json();
      if (couponData && couponData.data) {
        const now = new Date();
        const validCoupons = couponData.data.filter(c => {
          if (c.end_time && new Date(c.end_time) < now) return false;
          if (c.remain !== undefined && c.remain <= 0) return false;
          return true;
        });

        fetchedVouchers = validCoupons.map((c, idx) => ({
          id: `at_${c.id || idx}`,
          title: c.name || c.title || 'Mã Giảm Giá Shopee',
          code: c.coupons && c.coupons.length > 0 ? c.coupons[0].coupon_code : 'ACCESSTRADE30K',
          discountVal: c.discount || 'Khuyến Mãi',
          minSpendAmount: c.min_amount ? Number(c.min_amount) : 0,
          minSpend: c.min_amount ? `Đơn tối thiểu ${Number(c.min_amount).toLocaleString('vi-VN')}đ` : 'Áp dụng toàn sàn',
          maxDiscount: c.max_discount ? `Giảm tối đa ${Number(c.max_discount).toLocaleString('vi-VN')}đ` : 'Không giới hạn',
          startTime: c.start_time ? new Date(c.start_time).toLocaleString('vi-VN') : 'Đang diễn ra',
          endTime: c.end_time ? new Date(c.end_time).toLocaleString('vi-VN') : 'Chưa xác định',
          content: c.content || c.description || 'Áp dụng cho các sản phẩm hợp lệ trên Shopee theo quy định. Vui lòng thử áp dụng ở bước thanh toán.',
          isVipOnly: idx % 2 === 1,
          // If the API specifies category targeting, mark it. Otherwise sitewide.
          targetCategories: c.categories ? c.categories.map(cat => cat.category_name_show).join(', ') : 'Toàn Sàn'
        }));
      }
    } catch (cErr) {
      console.warn('[AccessTrade] Coupon API warning:', cErr.message);
    }

    // -----------------------------------------------------------------------
    // Mock Product Extraction Logic (since real scraping is blocked)
    // -----------------------------------------------------------------------
    function hashStringToInt(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        return Math.abs(hash);
    }
    
    const hashVal = hashStringToInt(originalUrl);
    let productPrice = (hashVal % 450000) + 50000; // Deterministic price 50k - 500k
    let productName = 'Sản Phẩm Shopee';
    let productImage = 'https://images.unsplash.com/photo-1607082348824-0a96f2a4b9da?w=500&auto=format&fit=crop&q=80';
    let productCategory = 'sitewide';
    
    try {
        const urlObj = new URL(originalUrl);
        const pathParts = urlObj.pathname.split('/');
        const slug = pathParts[1] || '';
        
        // Contextual category guessing
        const lowerSlug = slug.toLowerCase();
        if (['ao', 'quan', 'vay', 'giay', 'tui', 'balo', 'dong-ho', 'trang-suc', 'thoi-trang'].some(k => lowerSlug.includes(k))) productCategory = 'fashion';
        else if (['dien-thoai', 'tai-nghe', 'laptop', 'may-tinh', 'tivi', 'ban-phim', 'chuot', 'sac', 'cap', 'op-lung'].some(k => lowerSlug.includes(k))) productCategory = 'tech';
        else if (['son', 'kem-chong-nang', 'sua-rua-mat', 'trang-diem', 'nuoc-hoa', 'tay-trang'].some(k => lowerSlug.includes(k))) productCategory = 'beauty';
        else if (['ta', 'bim', 'sua', 'do-choi', 'xe-day', 'binh-sua'].some(k => lowerSlug.includes(k))) productCategory = 'mom';

        if (slug && slug.includes('-i.')) {
            const namePart = slug.split('-i.')[0];
            productName = namePart.split('-').join(' ');
            productName = productName.replace(/\b\w/g, l => l.toUpperCase());
        }
    } catch(e) {}

    // Addon calculation logic (Gợi ý mua kèm bù giá min_spend)
    // We will pass down some items and the frontend will calculate the gap
    const addonSuggestions = [
      {
        id: 'add1',
        title: 'Hộp Bỏ Túi Bảo Vệ Chống Nước',
        price: 19000,
        originalPrice: 45000,
        img: 'https://images.unsplash.com/photo-1583394838336-acd977736f90?w=200&auto=format&fit=crop&q=80'
      },
      {
        id: 'add2',
        title: 'Bộ Đệm Khí Memory Foam',
        price: 29000,
        originalPrice: 60000,
        img: 'https://images.unsplash.com/photo-1546435770-a3e426bf472b?w=200&auto=format&fit=crop&q=80'
      },
      {
        id: 'add3',
        title: 'Cáp Sạc Nhanh Type-C Dù Bọc Thép 60W',
        price: 39000,
        originalPrice: 80000,
        img: 'https://images.unsplash.com/photo-1600080972464-8e5f35f63d08?w=200&auto=format&fit=crop&q=80'
      },
      {
        id: 'add4',
        title: 'Khăn Lau Đa Năng Nano',
        price: 15000,
        originalPrice: 30000,
        img: 'https://images.unsplash.com/photo-1585421514738-01798e348b17?w=200&auto=format&fit=crop&q=80'
      }
    ];

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        shopeeUrl: originalUrl,
        affiliateUrl: affiliateUrl,
        isAffiliateConverted: isAffiliateConverted,
        productInfo: {
            name: productName,
            price: productPrice,
            image: productImage,
            category: productCategory
        },
        vouchers: fetchedVouchers,
        addonItems: addonSuggestions,
        timestamp: new Date().toISOString()
      })
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};

module.exports = async (req, res) => {
  const event = {
    httpMethod: req.method,
    queryStringParameters: req.query || {},
    body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {})
  };
  const result = await handler(event, {});
  if (result.headers) {
    for (const [k, v] of Object.entries(result.headers)) {
      res.setHeader(k, v);
    }
  }
  res.status(result.statusCode || 200).send(result.body);
};
