// js/savingsReport.js
/**
 * Module Tiết kiệm lũy kế
 */

async function loadSavingsReport() {
    const amountEl = document.getElementById('savings-amount');
    if (!amountEl) return;

    // TODO: cần backend cung cấp API tổng hợp chính xác, hiện tại tính tạm ở frontend chỉ để demo UI
    try {
        if (!isLoggedIn()) {
            amountEl.textContent = '0đ';
            return;
        }

        const response = await fetch(`${CONFIG.API_BASE_URL}/user/savings-report`, {
            headers: getAuthHeaders()
        });
        const data = await response.json();

        let totalSavings = 0;
        if (response.ok && data.success && data.data) {
            totalSavings = data.data.total_saved_display || 0;
        }

        // Animation chạy số
        animateValue(amountEl, 0, totalSavings, 1500);

    } catch (error) {
        console.error("Lỗi lấy báo cáo tiết kiệm:", error);
        amountEl.textContent = '0đ';
    }
}

function animateValue(obj, start, end, duration) {
    if (start === end) {
        obj.innerHTML = end.toLocaleString('vi-VN') + 'đ';
        return;
    }
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString('vi-VN') + 'đ';
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = end.toLocaleString('vi-VN') + 'đ';
        }
    };
    window.requestAnimationFrame(step);
}

// Chạy khi mở tab storage hoặc khởi tạo
document.addEventListener('DOMContentLoaded', () => {
    // Gọi ngay 1 lần hoặc có thể hook vào tab switch
    const tabStorage = document.getElementById('tab-storage');
    if (tabStorage) {
        tabStorage.addEventListener('click', loadSavingsReport);
    }
});
