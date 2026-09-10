const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { connectDB } = require('./db');
const app = require('./server-app');

const PORT = process.env.PORT || 3000;

// Start server after connecting to MongoDB (dùng khi chạy local)
async function startServer() {
    try {
        const db = await connectDB();
        console.log('MongoDB connection verified.');
        await db.collection('users').createIndex({ email: 1 }, { unique: true }).catch(() => {});

        const server = app.listen(PORT, () => {
            console.log(`🚀 Server is running on port ${PORT}`);
            console.log('Registered routes:');
            console.log('  GET  /health');
            console.log('  POST /api/auth/register');
            console.log('  POST /api/auth/login');
            console.log('  GET  /api/auth/me');
            console.log('  POST /api/vouchers/save');
            console.log('  GET  /api/vouchers/my-storage');
            console.log('  POST /api/vouchers/verify-and-use');
            console.log('  POST /api/vouchers/report-broken');
            console.log('  POST /api/payment/create-vip-order');
            console.log('  POST /api/payment/webhook');
            console.log('  POST /api/scan');
            console.log('  POST /api/user/generate-telegram-link-code');
            console.log('  POST /api/user/register');
            console.log('  GET  /api/user/export-my-data');
            console.log('  POST /api/user/request-deletion');
            console.log('  GET  /api/user/savings-report');
            console.log('  GET  /api/stats/success-rate');
        });
        return server;
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, startServer };
