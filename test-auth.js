const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const key = process.env.COINDCX_API_KEY;
const secret = process.env.COINDCX_API_SECRET;

const body = { timestamp: Math.floor(Date.now()) };
const payload = Buffer.from(JSON.stringify(body)).toString();
const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

axios.post('https://api.coindcx.com/exchange/v1/users/balances', body, {
  headers: {
    'X-AUTH-APIKEY': key,
    'X-AUTH-SIGNATURE': signature,
    'Content-Type': 'application/json'
  }
}).then(res => {
  console.log("Success! Balances:", res.data.length);
}).catch(err => {
  console.log("Error:", err.response ? err.response.status : err.message);
  if(err.response && err.response.data) console.log(err.response.data);
});
