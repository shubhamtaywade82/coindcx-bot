const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const key = process.env.COINDCX_API_KEY;
const secret = process.env.COINDCX_API_SECRET;
const headers = { 'Content-Type': 'application/json', 'X-AUTH-APIKEY': key };

function sign(body) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify(body)).toString()).digest('hex');
}

async function fetch() {
  const ts = Math.floor(Date.now());
  const body = { timestamp: ts };
  headers['X-AUTH-SIGNATURE'] = sign(body);
  
  try {
    const res = await axios.post('https://api.coindcx.com/exchange/v1/derivatives/futures/wallets', body, { headers });
    console.log("POST Success:", res.data);
  } catch (e) {
    console.log("POST failed:", e.response?.status, e.response?.data);
  }

  try {
    const res = await axios.get('https://api.coindcx.com/exchange/v1/derivatives/futures/wallets', { data: body, headers });
    console.log("GET Success:", res.data);
  } catch (e) {
    console.log("GET failed:", e.response?.status, e.response?.data);
  }
}
fetch();
