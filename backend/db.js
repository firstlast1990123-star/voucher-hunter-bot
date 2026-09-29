const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/";
const dbName = process.env.DB_NAME || "voucher_db";

let db = null;
let client = null;

async function connectDB(retries = 3) {
    if (db) return db;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            client = new MongoClient(uri, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 10000,
                connectTimeoutMS: 10000
            });
            await client.connect();
            db = client.db(dbName);
            console.log("✅ Kết nối MongoDB thành công");
            return db;
        } catch (error) {
            console.error(`❌ Lỗi kết nối MongoDB (thử lần ${attempt}/${retries}):`, error.message);
            if (attempt === retries) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }
    }
}

function getDB() {
    if (!db) {
        throw new Error("Chưa khởi tạo kết nối DB. Gọi connectDB() trước.");
    }
    return db;
}

module.exports = { connectDB, getDB };
