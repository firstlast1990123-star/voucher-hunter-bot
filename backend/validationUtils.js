/**
 * backend/validationUtils.js
 * Quản lý và chuẩn hóa lỗi validation cho toàn bộ hệ thống API
 */

/**
 * Chuyển đổi lỗi Joi thành thông báo tiếng Việt thân thiện,
 * tuyệt đối không làm lộ lỗi kỹ thuật thô ("value must be of type object") ra UI.
 * @param {import('joi').ValidationError} error 
 * @returns {string} Thông báo tiếng Việt thân thiện
 */
function formatJoiError(error) {
    if (!error || !error.details || !error.details.length) {
        return 'Dữ liệu gửi lên không hợp lệ, vui lòng thử lại.';
    }

    const item = error.details[0];
    const type = item.type;
    const path = item.path && item.path.length ? item.path.join('.') : '';

    // Trường hợp toàn bộ body không phải object (string, null, undefined, number...)
    if (type === 'object.base') {
        return 'Dữ liệu gửi lên không đúng định dạng yêu cầu, vui lòng thử lại.';
    }

    // Trường hợp thiếu trường bắt buộc
    if (type === 'any.required') {
        if (path === 'plan') return 'Vui lòng chọn gói VIP (Gói Tuần hoặc Gói Tháng).';
        if (path === 'voucher_code') return 'Vui lòng cung cấp mã giảm giá.';
        return `Vui lòng cung cấp đầy đủ thông tin: ${path}.`;
    }

    // Trường hợp giá trị không nằm trong danh sách cho phép (only / valid)
    if (type === 'any.only') {
        if (path === 'plan') return 'Gói VIP không hợp lệ. Vui lòng chọn Gói Tuần hoặc Gói Tháng.';
        return `Giá trị của trường ${path} không hợp lệ.`;
    }

    // Trường hợp kiểu chuỗi không đúng hoặc để trống
    if (type === 'string.base' || type === 'string.empty') {
        return `Thông tin ${path || 'đầu vào'} không được để trống.`;
    }

    return 'Dữ liệu gửi lên không hợp lệ, vui lòng kiểm tra lại.';
}

/**
 * Phòng thủ tự động parse body nếu body là Buffer hoặc chuỗi JSON thô
 * (thường xảy ra trên Vercel/Netlify/Serverless khi thiếu Content-Type header)
 * @param {any} body 
 * @returns {any}
 */
function parseRequestBody(body) {
    if (!body) return body;
    if (Buffer.isBuffer(body)) {
        try {
            return JSON.parse(body.toString('utf8'));
        } catch {
            return body;
        }
    }
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch {
            return body;
        }
    }
    return body;
}

module.exports = {
    formatJoiError,
    parseRequestBody
};
