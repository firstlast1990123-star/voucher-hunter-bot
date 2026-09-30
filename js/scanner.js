// js/scanner.js
/**
 * Xử lý Smart Scanner
 */

async function scanShopeeLink() {
    const inputEl = document.getElementById('scanner-input');
    const errorEl = document.getElementById('scanner-error');
    const resultContainer = document.getElementById('scanner-results');
    const btnEl = document.getElementById('btn-scan');
    
    // Yêu cầu đăng nhập trước khi dùng Smart Scanner
    if (typeof isLoggedIn === 'function' && !isLoggedIn()) {
        if (typeof showToast === 'function') {
            showToast("Vui lòng đăng nhập để sử dụng tính năng Smart Scanner.", "warning");
        }
        if (typeof openAuthModal === 'function') {
            openAuthModal('login');
        }
        return;
    }

    const url = inputEl.value.trim();
    
    // Clear old errors and results
    errorEl.classList.add('hidden');
    resultContainer.innerHTML = '';
    
    if (!url) {
        errorEl.textContent = 'Vui lòng nhập link Shopee';
        errorEl.classList.remove('hidden');
        return;
    }

    // 1. Regex kiểm tra link Shopee (hỗ trợ cả domain web lẫn link rút gọn chính thức shp.ee, vn.shp.ee, s.shopee.vn, shope.ee)
    const shopeeRegex = /^https?:\/\/(?:[a-zA-Z0-9-]+\.)*(?:shopee\.(?:vn|sg|com\.my|co\.id|co\.th|ph|tw|com\.br)|shp\.ee|shope\.ee)\/.+/i;
    if (!shopeeRegex.test(url)) {
        errorEl.textContent = 'Link không hợp lệ. Vui lòng dán link Shopee chuẩn (VD: https://shopee.vn/... hoặc https://vn.shp.ee/...)';
        errorEl.classList.remove('hidden');
        return;
    }

    // Tạm khóa UI
    inputEl.disabled = true;
    btnEl.disabled = true;
    
    // Render Loading Skeleton với Icon Scanner trung lập
    resultContainer.innerHTML = `
        <div class="bg-white rounded-lg p-6 shadow border border-gray-200 mt-6 text-center animate-pulse">
            <div class="w-16 h-16 mx-auto mb-4 flex items-center justify-center rounded-full bg-orange-100 text-orange-500 border-4 border-orange-200 shadow-sm text-3xl">
                🔍
            </div>
            <div class="h-4 bg-gray-200 rounded w-1/2 mx-auto mb-3"></div>
            <div class="h-3 bg-gray-200 rounded w-1/3 mx-auto"></div>
            <p class="mt-4 text-orange-500 font-medium">Đang đối chiếu và tìm mã giảm giá công khai...</p>
        </div>
    `;

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/scan`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ 
                shopee_link: url
            })
        });

        if (res.status === 401) {
            errorEl.textContent = 'Vui lòng đăng nhập để sử dụng tính năng Smart Scanner.';
            errorEl.classList.remove('hidden');
            resultContainer.innerHTML = '';
            if (typeof showToast === 'function') {
                showToast("Vui lòng đăng nhập để tiếp tục.", "warning");
            }
            if (typeof openAuthModal === 'function') {
                openAuthModal('login');
            }
            return;
        }
        
        const data = await res.json();
        
        const shopName = data.shop_name || 'Shopee';
        let html = `<div class="mt-6 mb-3 text-lg font-bold text-gray-800">✅ Đã tìm thấy mã cho shop: <span class="text-orange-500">${shopName}</span></div>`;
        if (data.resolved_url) {
            html += `<div class="text-xs text-gray-500 mb-3 truncate">🔗 Link gốc: <a href="${data.resolved_url}" target="_blank" rel="noopener noreferrer" class="text-blue-500 hover:underline">${data.resolved_url}</a></div>`;
        }
        
        if (data.new_vouchers_hidden_count > 0) {
            html += `
                <div class="bg-orange-50 border border-orange-200 text-orange-600 rounded p-3 mb-4 text-sm font-medium flex items-center justify-between">
                    <span>🔥 Có ${data.new_vouchers_hidden_count} mã mới vừa được phát hiện đang chờ hiển thị (VIP xem ngay)</span>
                    <button onclick="upgradeToVIP()" class="bg-orange-500 text-white px-3 py-1 rounded shadow-sm text-xs ml-2 hover:bg-orange-600">Nâng cấp VIP</button>
                </div>
            `;
        }

        if (data.vouchers && data.vouchers.length > 0) {
            html += '<div class="grid grid-cols-1 md:grid-cols-2 gap-4">';
            data.vouchers.forEach(v => {
                html += renderVoucherCard(v);
            });
            html += '</div>';
        } else {
            html += `<div class="text-gray-500 text-center py-4">${data.message || 'Chưa tìm thấy mã'}</div>`;
        }
        
        resultContainer.innerHTML = html;

    } catch (error) {
        console.error("Scan error:", error);
        resultContainer.innerHTML = `
            <div class="bg-red-50 text-red-600 p-4 rounded-lg mt-6 border border-red-200 text-center">
                Có lỗi xảy ra khi quét dữ liệu. Vui lòng thử lại sau!
            </div>
        `;
    } finally {
        // Mở khóa UI
        inputEl.disabled = false;
        btnEl.disabled = false;
    }
}
