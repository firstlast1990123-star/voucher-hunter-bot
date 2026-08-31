// Netlify Function: Real User Stats Tracker
// Tracks actual page visits - NO random, NO fake data

// In-memory store (resets on cold start, which is fine for serverless)
// For persistent tracking, use a database like Supabase/Firebase
let visitLog = {
  totalVisits: 0,
  todayVisits: 0,
  todayDate: new Date().toISOString().split('T')[0], // YYYY-MM-DD
  monthVisits: 0,
  currentMonth: new Date().getMonth()
};

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const today = new Date().toISOString().split('T')[0];
  const currentMonth = new Date().getMonth();

  // Reset daily counter if date changed
  if (today !== visitLog.todayDate) {
    visitLog.todayVisits = 0;
    visitLog.todayDate = today;
  }

  // Reset monthly counter if month changed
  if (currentMonth !== visitLog.currentMonth) {
    visitLog.monthVisits = 0;
    visitLog.currentMonth = currentMonth;
  }

  // POST = new page visit (increment)
  if (event.httpMethod === 'POST') {
    visitLog.totalVisits += 1;
    visitLog.todayVisits += 1;
    visitLog.monthVisits += 1;
  }

  // GET = just read current stats (no increment)
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      success: true,
      stats: {
        todayVisits: visitLog.todayVisits,
        monthVisits: visitLog.monthVisits,
        totalVisits: visitLog.totalVisits
      },
      date: today,
      note: 'Dữ liệu này được đếm trực tiếp từ số lượt truy cập thực tế vào trang web. Không sử dụng bất kỳ hàm random hay công thức giả lập nào.'
    })
  };
};
