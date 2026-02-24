require('dotenv').config();
const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const { Pool } = require('pg');
const twilio = require('twilio');


const client = twilio(
  process.env.TWILIO_SID,
  process.env.TWILIO_AUTH
);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
const ADMIN_KEY = "andhra_admin_2026";

/* ================= POSTGRESQL CONNECTION ================= */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ================= CREATE TABLE ================= */
pool.query(`
CREATE TABLE IF NOT EXISTS orders (
  id SERIAL PRIMARY KEY,
  orderCode TEXT UNIQUE,
  name TEXT,
  mobile TEXT,
  address TEXT,
  items JSONB,
  total INTEGER,
  payment_status TEXT,
  order_status TEXT DEFAULT 'Pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
`);

/* ================= TWILIO CLIENT ================= */

/* ================= HELPER FUNCTIONS ================= */
function sendAdminAlert(order){
  const message = `🛒 NEW ORDER RECEIVED\nOrder Code: ${order.code}\nName: ${order.name}\nTotal: ₹${order.total}`;
  const admins = [
    'whatsapp:+919989506803',
    'whatsapp:+919908239101'
  ];
  admins.forEach(num=>{
    client.messages.create({
      from: 'whatsapp:+14155238886',
      to: num,
      body: message
    })
    .then(()=>console.log("Admin notified"))
    .catch(err=>console.log("WhatsApp admin error", err));
  });
}

function sendCustomerApprovedMsg(order){
  const msg = `✅ Your order is approved!\n🍽 Andhra Tiffens\nOrder Code: ${order.ordercode}\nTotal: ₹${order.total}\nYour order is confirmed and will arrive shortly 🛵\nThank you for ordering 🙏`;
  client.messages.create({
    from: 'whatsapp:+14155238886',
    to: `whatsapp:+91${order.mobile}`,
    body: msg
  })
  .then(()=>console.log("Customer notified"))
  .catch(err=>console.log("WhatsApp customer error", err));
}

/* ================= RAZORPAY ================= */
const razorpay = new Razorpay({
  key_id: process.env.KEY_ID,
  key_secret: process.env.KEY_SECRET
});

/* ================= ROOT ROUTE ================= */
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/cart.html');
});

/* ================= CREATE ORDER ================= */
app.post('/create-order', async (req, res) => {
  try {
    const { name, mobile, address, items, subtotal } = req.body;

    if (!name || !mobile || !address || !items) {
      return res.status(400).json({ error: "Missing fields" });
    }

    let hasMeals = items.some(item =>
      item.name === "Veg Meals" || item.name === "Non-Veg Meals"
    );

    let delivery = 0;
    if (!hasMeals && subtotal > 0 && subtotal < 120) {
      delivery = 30;
    }

    const total = subtotal + delivery;
    const orderCode = "AT" + Date.now();

    const razorOrder = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: orderCode
    });

    await pool.query(
      `INSERT INTO orders
      (orderCode, name, mobile, address, items, total, payment_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        orderCode,
        name,
        mobile,
        address,
        JSON.stringify(items),
        total,
        "Created"
      ]
    );

    // Admin WhatsApp alert
    const order = { code: orderCode, name, total };
    sendAdminAlert(order);

    res.json({
      key: process.env.KEY_ID,
      amount: total,
      razorpayOrderId: razorOrder.id,
      orderCode
    });

  } catch (err) {
    console.log("Create order error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================= VERIFY PAYMENT ================= */
app.post('/verify-payment', async (req, res) => {
  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    orderCode
  } = req.body;

  const generated_signature = crypto
    .createHmac("sha256", process.env.KEY_SECRET)
    .update(razorpay_order_id + "|" + razorpay_payment_id)
    .digest("hex");

  if (generated_signature === razorpay_signature) {
    await pool.query(
      `UPDATE orders
       SET payment_status='Paid'
       WHERE orderCode=$1`,
      [orderCode]
    );
    res.json({ success: true });
  } else {
    await pool.query(
      `UPDATE orders
       SET payment_status='Failed'
       WHERE orderCode=$1`,
      [orderCode]
    );
    res.json({ success: false });
  }
});

/* ================= ADMIN PAGE PROTECTION ================= */
app.use('/admin.html', (req, res, next) => {
  if (req.query.key === ADMIN_KEY) next();
  else res.status(403).send("Access Denied 🔒");
});

/* ================= GET ALL ORDERS (ADMIN) ================= */
app.get('/orders', async (req, res) => {
  const result = await pool.query(
    "SELECT * FROM orders ORDER BY created_at DESC"
  );
  res.json(result.rows);
});

/* ================= APPROVE ORDER ================= */
app.post('/approve/:code', async (req, res) => {
  const code = req.params.code;

  await pool.query(
    "UPDATE orders SET order_status='Approved' WHERE orderCode=$1",
    [code]
  );

  const result = await pool.query(
    `SELECT * FROM orders WHERE orderCode=$1`,
    [code]
  );

  const order = result.rows[0];

  // Customer WhatsApp notification
  sendCustomerApprovedMsg(order);

  res.json({ success: true });
});

/* ================= CHECK ORDER STATUS ================= */
app.get('/order-status/:code', async (req, res) => {
  const result = await pool.query(
    "SELECT order_status FROM orders WHERE orderCode=$1",
    [req.params.code]
  );

  if (result.rows.length === 0) {
    return res.json({ order_status: "Pending" });
  }

  res.json(result.rows[0]);
});

/* ================= MY ORDERS ================= */
app.get('/my-orders/:mobile', async (req, res) => {
  const result = await pool.query(
    `SELECT orderCode, total, created_at, order_status
     FROM orders
     WHERE mobile=$1
     ORDER BY created_at DESC`,
    [req.params.mobile]
  );

  res.json(result.rows);
});

/* ================= MENU ITEMS ================= */
app.get('/items', (req, res) => {

  res.json([
    { name: "Idli (3)", price: 20, image: "idli.jpg", available: true },
    { name: "Plain Dosa", price: 20, image: "dosa.jpg", available: true },
    { name: "Pidi Dosa", price: 25, image: "dosa.jpg", available: true },
    { name: "Onion Dosa", price: 25, image: "dosa.jpg", available: true },
    { name: "Karam Dosa", price: 25, image: "dosa.jpg", available: true },
    { name: "Masala Dosa", price: 35, image: "masala-dosa.jpg", available: true },
    { name: "Egg Masala Dosa", price: 50, image: "egg-dosa.jpg", available: true },
    { name: "Ghee Dosa", price: 40, image: "dosa.jpg", available: true },
    { name: "Kal Dosa (2)", price: 45, image: "dosa.jpg", available: true },
    { name: "Chapati (3)", price: 60, image: "chapathi.jpg", available: true },

    { name: "Single Egg Dosa", price: 35, image: "egg-dosa.jpg", available: true },
    { name: "Double Egg Dosa", price: 45, image: "egg-dosa.jpg", available: true },
    { name: "Omelette / Half Boil", price: 15, image: "omelette.jpg", available: true },

    { name: "Bajji (2)", price: 20, image: "bajji.jpg", available: true },
    { name: "Egg Bajji (2)", price: 20, image: "egg-bajji.jpg", available: true },
    { name: "Potato Bajji (2)", price: 20, image: "potato-bajji.jpg", available: true },
    { name: "Bonda (6)", price: 20, image: "bonda.jpg", available: true },
    { name: "Onion Bonda (2)", price: 20, image: "onion-bonda.jpg", available: true },
    { name: "Mysore Bonda (2)", price: 20, image: "mysore-bonda.jpg", available: true },
    { name: "Sweet Bonda (3)", price: 20, image: "sweet-bonda.jpg", available: true },

    { name: "Veg Meals", price: 100, image: "veg-meals.jpg", available: true },
    { name: "Non-Veg Meals", price: 120, image: "non-veg-meals.jpg", available: true }
  ]);

});

/* ================= START SERVER ================= */
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});