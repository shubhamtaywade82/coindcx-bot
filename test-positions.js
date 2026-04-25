const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const key = process.env.COINDCX_API_KEY;
const secret = process.env.COINDCX_API_SECRET;
const headers = { 'Content-Type': 'application/json', 'X-AUTH-APIKEY': key };

function sign(body) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify(body)).toString()).digest('hex');
}

async function fetchPos() {
  const ts = Math.floor(Date.now());
  const body = { timestamp: ts, page: "1", size: "100", margin_currency_short_name: ["USDT", "INR"] };
  headers['X-AUTH-SIGNATURE'] = sign(body);
  
  try {
    const res = await axios.post('https://api.coindcx.com/exchange/v1/derivatives/futures/positions', body, { headers });
    console.log("POST positions Success:", res.data.length, Array.isArray(res.data));
  } catch (e) {
    console.log("POST failed:", e.response?.status, e.response?.data);
  }
}
fetchPos();
