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
  
  // Try spot balances
  try {
    const b1 = { timestamp: ts };
    const h1 = { ...headers, 'X-AUTH-SIGNATURE': sign(b1) };
    const r1 = await axios.post('https://api.coindcx.com/exchange/v1/users/balances', b1, {headers: h1});
    console.log("Spot Balances:", r1.data.filter(b => parseFloat(b.balance) > 0 || parseFloat(b.locked_balance) > 0));
  } catch (e) { console.log("Spot error:", e.response?.data?.message || e.message); }

  // Try margin balances
  try {
    const b2 = { timestamp: ts };
    const h2 = { ...headers, 'X-AUTH-SIGNATURE': sign(b2) };
    const r2 = await axios.post('https://api.coindcx.com/exchange/v1/margin/users/balances', b2, {headers: h2});
    console.log("Margin Balances:", r2.data.filter(b => parseFloat(b.balance) > 0 || parseFloat(b.locked_balance) > 0));
  } catch (e) { console.log("Margin error:", e.response?.data?.message || e.message); }
  
  // Try derivatives balances v2
  try {
    const b4 = { timestamp: ts };
    const h4 = { ...headers, 'X-AUTH-SIGNATURE': sign(b4) };
    const r4 = await axios.post('https://api.coindcx.com/exchange/v1/derivatives/futures/balances', b4, {headers: h4});
    console.log("Futures Balances:", r4.data);
  } catch (e) { console.log("Futures error:", e.response?.data?.message || e.message); }
}
fetch();
