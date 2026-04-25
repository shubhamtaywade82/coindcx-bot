const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const key = process.env.COINDCX_API_KEY;
const secret = process.env.COINDCX_API_SECRET;
const headers = { 'Content-Type': 'application/json', 'X-AUTH-APIKEY': key };

function sign(body) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify(body)).toString()).digest('hex');
}

async function tryPath(path) {
  try {
    const b = { timestamp: Math.floor(Date.now()) };
    const h = { ...headers, 'X-AUTH-SIGNATURE': sign(b) };
    const r = await axios.post('https://api.coindcx.com' + path, b, {headers: h});
    console.log(path, "=>", r.data);
  } catch (e) {
    // console.log(path, "error", e.response?.status);
  }
}

async function fetch() {
  await tryPath('/exchange/v1/users/balances');
  await tryPath('/exchange/v1/derivatives/futures/wallet_balances');
  await tryPath('/exchange/v1/derivatives/futures/balances');
  await tryPath('/exchange/v1/derivatives/futures/account');
  await tryPath('/exchange/v1/derivatives/futures/user/balances');
  await tryPath('/exchange/v1/derivatives/futures/account_balance');
}
fetch();
