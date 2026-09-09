// js/voucherCard.js
/**
 * Quản lý component Card mã giảm giá
 */

/**
 * Xử lý lưu voucher vào kho (gọi API backend)
 */
async function saveVoucher(code, btnElement) {
    if (btnElement.disabled) return;
    
    // Tạm khóa nút
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '<span class="animate-spin inline-block mr-1">⏳</span> Đang xử lý...';

    try {
        if (!isLoggedIn()) {
            showToast("Vui lòng đăng nhập để lưu mã vào kho.", "warning");
            if (typeof openAuthModal === 'function') openAuthModal('login');
            return;
        }

        const response = await fetch(`${CONFIG.API_BASE_URL}/vouchers/save`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ voucher_code: code })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            showToast("Lưu trữ thành công", "success");
        } else {
            if (response.status === 401) {
                showToast("Vui lòng đăng nhập lại để lưu mã.", "warning");
                if (typeof openAuthModal === 'function') openAuthModal('login');
            } else if (response.status === 403 && data.error === 'FREE_LIMIT_REACHED') {
                showToast("Bạn đã đạt giới hạn 10 mã. Nâng cấp VIP để lưu thêm.", "error");
            } else {
                showToast(data.message || "Lỗi khi lưu mã", "error");
            }
        }
    } catch (error) {
        console.error("Save voucher error:", error);
        showToast("Lỗi kết nối mạng, vui lòng thử lại.", "error");
    } finally {
        // Phục hồi nút
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
    }
}

/**
 * Render HTML cho một thẻ voucher
 * @param {Object} v - Dữ liệu voucher
 */
function renderVoucherCard(v) {
    // Nếu voucher bị khóa (Free user quá 10 mã)
    if (v.locked) {
        return `
        <div class="relative bg-white rounded-lg p-4 shadow flex flex-col h-full overflow-hidden border border-gray-200">
            <div class="opacity-30 blur-[3px] pointer-events-none flex flex-col h-full">
                <div class="flex items-center mb-3">
                    <img src="${CONFIG.SHOPEE_LOGO_URL}" class="w-10 h-10 object-contain p-1 border rounded mr-3 bg-gray-50" />
                    <div>
                        <div class="font-bold text-gray-800">${v.merchant || 'Shopee'}</div>
                        <div class="text-sm text-gray-500 line-clamp-1">${v.title || 'Mã giảm giá'}</div>
                    </div>
                </div>
                <div class="flex-grow">
                    <div class="text-xl font-extrabold text-orange-500 mb-2">${v.discount_value || 'Giảm sốc'}</div>
                    <div class="text-sm text-gray-600 border border-dashed border-gray-300 p-2 text-center rounded bg-gray-50">
                        ***LOCKED***
                    </div>
                </div>
            </div>
            
            <!-- Overlay Nâng cấp VIP -->
            <div class="absolute inset-0 z-10 flex flex-col items-center justify-center bg-white/60">
                <i class="text-3xl mb-2">🔒</i>
                <button onclick="upgradeToVIP()" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow transition transform hover:-translate-y-1">
                    Nâng cấp VIP để mở khóa
                </button>
            </div>
        </div>
        `;
    }

    // Voucher bình thường
    const type = v.voucher_type || 'code'; 
    const isCode = type === 'code';
    const codeDisplay = v.code || '';
    
    // Giao diện Action button
    let actionHtml = '';
    if (isCode) {
        actionHtml = `
            <div class="mt-4 flex gap-2">
                <div class="flex-grow text-center font-mono font-bold text-gray-700 bg-gray-100 border border-dashed border-gray-300 rounded py-2 px-2 truncate">
                    ${codeDisplay}
                </div>
                <button onclick="copyVoucherCode('${codeDisplay}', this)" class="bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow transition flex-shrink-0">
                    Sao chép mã
                </button>
            </div>
        `;
    } else {
        actionHtml = `
            <div class="mt-4">
                <button onclick="saveDeeplinkVoucher('${v.code}', '${v.landing_url}', this)" class="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-2 px-4 rounded shadow transition">
                    Lưu vào ví
                </button>
            </div>
        `;
    }
    
    // Nút Báo mã lỗi
    const reportHtml = `
        <button onclick="reportBrokenVoucher('${v.code}')" class="absolute top-2 right-2 text-xs bg-gray-100 hover:bg-gray-200 text-gray-500 px-2 py-1 rounded shadow-sm border border-gray-200">
            ⚠️ Báo mã lỗi
        </button>
    `;

    // Hiển thị điều kiện mã rõ ràng
    let discountText = v.discount_value || 'Giảm sốc';
    if (v.discount_type === 'percent') {
        discountText = `Giảm ${v.discount_value}%`;
        if (v.discount_max_value) {
            discountText += `, tối đa ${v.discount_max_value}đ`;
        }
    } else if (v.discount_type === 'fixed') {
        discountText = `Giảm ${v.discount_value}đ`;
    }

    return `
    <div id="card-${v.code}" class="relative bg-white rounded-lg p-4 shadow flex flex-col h-full border border-gray-200 transition hover:shadow-lg">
        ${reportHtml}
        <div class="flex items-center mb-3 pr-20">
            <img src="${CONFIG.SHOPEE_LOGO_URL}" class="w-10 h-10 object-contain p-1 border rounded mr-3 bg-gray-50" />
            <div>
                <div class="font-bold text-gray-800">${v.merchant || 'Shopee'}</div>
                <div class="text-sm text-gray-500 line-clamp-1">${v.title || 'Mã giảm giá'}</div>
            </div>
        </div>
        <div class="flex-grow">
            <div class="text-xl font-extrabold text-orange-500">${discountText}</div>
            ${v.min_order_value ? `<div class="text-xl font-bold text-gray-700 mt-1">Đơn tối thiểu ${v.min_order_value.toLocaleString()}đ</div>` : ''}
            ${v.valid_to ? `<div class="text-xs text-red-500 mt-2 font-medium">HSD: ${new Date(v.valid_to).toLocaleDateString()}</div>` : ''}
        </div>
        ${actionHtml}
    </div>
    `;
}

/**
 * Hàm chung để verify mã trước khi dùng
 */
async function verifyAndUse(code, btnElement) {
    if (btnElement.disabled) return false;
    
    btnElement.disabled = true;
    const originalText = btnElement.innerHTML;
    btnElement.innerHTML = '<span class="animate-spin inline-block mr-1">⏳</span> Đang kiểm tra...';
    
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/vouchers/verify-and-use`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ voucher_code: code })
        });
        const data = await res.json();
        
        if (data.valid) {
            return data;
        } else {
            showToast(`Mã này vừa bị lỗi/hết lượt. Lý do: ${data.reason}`, 'error');
            // Ẩn card cũ
            const card = document.getElementById(`card-${code}`);
            
            if (data.suggested_alternatives && data.suggested_alternatives.length > 0) {
                let altHtml = '<div class="mt-4 pt-4 border-t border-gray-200"><div class="text-sm font-bold text-gray-700 mb-2">💡 Có thể bạn quan tâm mã khác:</div><div class="grid grid-cols-1 gap-3">';
                data.suggested_alternatives.forEach(alt => {
                    altHtml += renderVoucherCard(alt);
                });
                altHtml += '</div></div>';
                if (card) {
                    card.innerHTML = `<div class="p-3 text-red-500 font-medium">❌ Mã đã hết hạn</div>` + altHtml;
                }
            } else {
                if (card) card.style.display = 'none';
            }
            return false;
        }
    } catch (e) {
        console.error("Lỗi verify:", e);
        showToast("Lỗi mạng khi kiểm tra mã.", "error");
        return false;
    } finally {
        btnElement.disabled = false;
        btnElement.innerHTML = originalText;
    }
}

/**
 * Xử lý click copy mã text
 */
async function copyVoucherCode(code, btnElement) {
    const verified = await verifyAndUse(code, btnElement);
    if (!verified) return;
    
    navigator.clipboard.writeText(code).then(() => {
        saveVoucher(code, btnElement);
    }).catch(err => {
        console.error("Không thể copy:", err);
        showToast("Không thể sao chép, vui lòng thử thủ công.", "error");
    });
}

/**
 * Xử lý click lưu deeplink
 */
async function saveDeeplinkVoucher(code, url, btnElement) {
    const verified = await verifyAndUse(code, btnElement);
    if (!verified) return;
    
    // 1. Lưu DB
    saveVoucher(code, btnElement).then(() => {
        // 2. Mở app/web 
        setTimeout(() => {
            const finalUrl = verified.landing_url || url;
            if (finalUrl && finalUrl !== '#' && finalUrl !== '***LOCKED***') {
                window.open(finalUrl, '_blank');
            }
        }, 500);
    });
}

/**
 * Báo mã lỗi
 */
async function reportBrokenVoucher(code) {
    try {
        if (!isLoggedIn()) {
            showToast("Vui lòng đăng nhập để gửi báo cáo lỗi mã.", "warning");
            if (typeof openAuthModal === 'function') openAuthModal('login');
            return;
        }

        const res = await fetch(`${CONFIG.API_BASE_URL}/vouchers/report-broken`, {
            method: 'POST',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ voucher_code: code })
        });
        if (res.ok) {
            showToast("Cảm ơn bạn đã báo cáo, hệ thống đang kiểm tra lại.", "info");
        } else if (res.status === 401) {
            showToast("Vui lòng đăng nhập lại để báo lỗi.", "warning");
            if (typeof openAuthModal === 'function') openAuthModal('login');
        }
    } catch (e) {
        showToast("Lỗi mạng khi gửi báo cáo.", "error");
    }
}

/**
 * Mở modal chọn gói VIP (Gói Tuần hoặc Gói Tháng)
 */
function upgradeToVIP() {
    if (!isLoggedIn()) {
        showToast("Vui lòng đăng nhập để nâng cấp VIP.", "warning");
        if (typeof openAuthModal === 'function') openAuthModal('login');
        return;
    }
    if (typeof openVipModal === 'function') {
        openVipModal();
    }
}
