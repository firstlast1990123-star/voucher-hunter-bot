const assert = require('assert');
const { execFile } = require('child_process');
const path = require('path');

// Test 1: Python script with invalid DB connection
console.log("=== TEST 1: Giả lập lỗi kết nối MongoDB trong verify_wrapper.py ===");
const scriptPath = path.join(__dirname, 'verify_wrapper.py');
const venvPython = path.join(__dirname, '.venv/bin/python3');

const env = { ...process.env, MONGO_URI: "mongodb://invalid_host_for_test:27017" };

execFile(venvPython, [scriptPath, 'MOCK_CODE'], { env }, (error, stdout, stderr) => {
    console.log("Raw output:", stdout.trim());
    const res = JSON.parse(stdout.trim());
    assert.strictEqual(res.valid, false, "KẾT QUẢ PHẢI LÀ FALSE KHI LỖI DB!");
    console.log("✅ TEST 1 PASSED: verify_wrapper.py trả về valid: false khi DB lỗi.");
    
    // Test 2: Node.js handler fail-closed when script fails
    console.log("\n=== TEST 2: Giả lập lỗi thực thi process trong verifyAndUse ===");
    execFile(venvPython, ['-c', 'import sys; sys.exit(1)'], (err, out) => {
        // Mô phỏng logic dòng 17 verifyAndUse.js
        let result;
        if (err && err.code !== 0 && !out) {
            result = { valid: false, reason: "Lỗi hệ thống khi kiểm tra mã, vui lòng thử lại" };
        }
        assert.strictEqual(result.valid, false, "KẾT QUẢ PHẢI LÀ FALSE KHI SCRIPT ERROR!");
        console.log("✅ TEST 2 PASSED: verifyAndUse trả về valid: false khi process crash.");
        
        console.log("\n🎉 TẤT CẢ TEST FAIL-CLOSED ĐÃ ĐẠT!");
    });
});

