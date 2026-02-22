const ADMIN_KEY = "andhra_admin_2026";

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const Razorpay = require('razorpay');
const crypto = require('crypto');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Protect admin page
app.use('/admin.html', (req, res, next) => {
  const key = req.query.key;
  if (key === ADMIN_KEY) {
    next();
  } else {
    res.status(403).send("Access Denied 🔒");
  }
});

// Serve static files
app.use(express.static('public'));

// Force home route
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Razorpay keys
const KEY_ID = process.env.KEY_ID;
const KEY_SECRET = process.env.KEY_SECRET;

const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET
});
// ---------------- DATABASE ----------------


// Items Table
const db = new sqlite3.Database('./orders.db', (err) => {
  if (err) {
    console.error("Database connection error:", err);
  } else {
    console.log("Database connected ✅");

    db.serialize(() => {

      db.run(`
        CREATE TABLE IF NOT EXISTS orders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          orderCode TEXT,
          name TEXT,
          mobile TEXT,
          address TEXT,
          items TEXT,
          subtotal INTEGER,
          delivery INTEGER,
          total INTEGER,
          payment_status TEXT,
          order_status TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);

      db.run(`
        CREATE TABLE IF NOT EXISTS items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE,
          price INTEGER,
          image TEXT,
          available INTEGER DEFAULT 1
        )
      `);

      const defaultItems = [
        ["Idli (3)", 20, "idli.jpg"],
        ["Plain Dosa", 20, "dosa.jpg"],
        ["Podi Dosa", 25, "dosa.jpg"],
        ["Onion Dosa", 25, "dosa.jpg"],
        ["Karam Dosa", 25, "dosa.jpg"],
        ["Masala Dosa", 35, "masala-dosa.jpg"],
        ["Egg Masala Dosa", 50, "egg-dosa.jpg"],
        ["Ghee Dosa", 40, "dosa.jpg"],
        ["Kal Dosa (2)", 45, "dosa.jpg"],
        ["Chapati (3)", 60, "chapathi.jpg"],
        ["Single Egg Dosa", 35, "egg-dosa.jpg"],
        ["Double Egg Dosa", 45, "egg-dosa.jpg"],
        ["Omelette / Half Boil", 15, "omelette.jpg"],
        ["Bajji (2)", 20, "bajji.jpg"],
        ["Egg Bajji (2)", 20, "egg-bajji.jpg"],
        ["Potato Bajji (2)", 20, "potato-bajji.jpg"],
        ["Bonda (6)", 20, "bonda.jpg"],
        ["Onion Bonda (2)", 20, "onion-bonda.jpg"],
        ["Mysore Bonda (2)", 20, "mysore-bonda.jpg"],
        ["Sweet Bonda (3)", 20, "sweet-bonda.jpg"],
        ["Veg Meals", 100, "veg-meals.jpg"],
        ["Non-Veg Meals", 120, "non-veg-meals.jpg"]
      ];

      defaultItems.forEach(item => {
        db.run(
          "INSERT OR IGNORE INTO items (name, price, image) VALUES (?, ?, ?)",
          item
        );
      });

      console.log("Tables ensured & items inserted ✅");

    });
  }
});
// ---------------- ITEMS API ----------------
app.get('/items', (req, res) => {
  db.all("SELECT * FROM items", [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/toggle-item', (req, res) => {
  const { id, available } = req.body;

  db.run(
    "UPDATE items SET available = ? WHERE id = ?",
    [available, id],
    function(err) {
      if (err) res.json({ success: false });
      else res.json({ success: true });
    }
  );
});

// ---------------- CREATE ORDER ----------------
app.post('/create-order', async (req, res) => {

  const { name, mobile, address, items, subtotal } = req.body;

  const delivery = subtotal < 120 ? 30 : 0;
  const total = subtotal + delivery;

  const orderCode = "AT" + Date.now();

  try {
    const razorOrder = await razorpay.orders.create({
      amount: total * 100,
      currency: "INR",
      receipt: orderCode
    });

    db.run(`
      INSERT INTO orders
      (orderCode, name, mobile, address, items, subtotal, delivery, total, payment_status, order_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      orderCode,
      name,
      mobile,
      address,
      JSON.stringify(items),
      subtotal,
      delivery,
      total,
      "Pending",
      "Pending"
    ]);

    res.json({
      key: KEY_ID,
      amount: total,
      razorpayOrderId: razorOrder.id,
      orderCode: orderCode
    });

  } catch (error) {
    console.log("Create order error:", error);
    res.status(500).json({ error: "Order creation failed" });
  }
});

// ---------------- VERIFY PAYMENT ----------------
app.post('/verify-payment', (req, res) => {

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderCode } = req.body;

  const body = razorpay_order_id + "|" + razorpay_payment_id;

  const expectedSignature = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(body.toString())
    .digest("hex");

  if (expectedSignature === razorpay_signature) {

    db.run(
      "UPDATE orders SET payment_status = 'Paid' WHERE orderCode = ?",
      [orderCode]
    );

    res.json({ success: true });

  } else {
    res.json({ success: false });
  }
});

// ---------------- ADMIN ----------------
app.get('/orders', (req, res) => {
  db.all("SELECT * FROM orders ORDER BY created_at DESC", [], (err, rows) => {
    res.json(rows);
  });
});

app.post('/approve-order', (req, res) => {
  const { orderCode } = req.body;

  db.run(
    "UPDATE orders SET order_status = 'Approved' WHERE orderCode = ?",
    [orderCode],
    function(err) {
      if (err) res.json({ success: false });
      else res.json({ success: true });
    }
  );
});

// ---------------- START SERVER ----------------
// ---------------- START SERVER ----------------
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});