const axios = require('axios');
const crypto = require('crypto');
require('dotenv').config();

const key = process.env.COINDCX_API_KEY;
const secret = process.env.COINDCX_API_SECRET;
const headers = { 'Content-Type': 'application/json', 'X-AUTH-APIKEY': key };

async function fetch() {
  // Balances
  const bBody = { timestamp: Math.floor(Date.now()) };
  headers['X-AUTH-SIGNATURE'] = crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify(bBody)).toString()).digest('hex');
  const balances = await axios.post('https://api.coindcx.com/exchange/v1/users/balances', bBody, {headers}).then(r=>r.data).catch(e=>e.message);
  console.log("Balances data:", JSON.stringify(balances).substring(0, 300));
  
  // Positions
  const pBody = { timestamp: Math.floor(Date.now()) };
  headers['X-AUTH-SIGNATURE'] = crypto.createHmac('sha256', secret).update(Buffer.from(JSON.stringify(pBody)).toString()).digest('hex');
  const positions = await axios.post('https://api.coindcx.com/exchange/v1/derivatives/futures/positions', pBody, {headers}).then(r=>r.data).catch(e=>e.message);
  console.log("Positions data:", JSON.stringify(positions).substring(0, 300));
}
fetch();
