const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/";
const dbName = process.env.DB_NAME || "voucher_db";

let db = null;

async function connectDB() {
    if (db) return db;
    try {
        const client = new MongoClient(uri);
        await client.connect();
        db = client.db(dbName);
        console.log("✅ Kết nối MongoDB thành công");
        return db;
    } catch (error) {
        console.error("❌ Lỗi kết nối MongoDB:", error);
        throw error;
    }
}

function getDB() {
    if (!db) {
        throw new Error("Chưa khởi tạo kết nối DB. Gọi connectDB() trước.");
    }
    return db;
}

module.exports = { connectDB, getDB };
