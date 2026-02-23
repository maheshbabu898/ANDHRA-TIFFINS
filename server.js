require('dotenv').config();

const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');
const { Pool } = require('pg');

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
      item.name === "Veg Meals" ||
      item.name === "Non-Veg Meals"
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

  await pool.query(
    "UPDATE orders SET order_status='Approved' WHERE orderCode=$1",
    [req.params.code]
  );

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

/* ================= START SERVER ================= */

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});