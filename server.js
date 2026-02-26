// ============================================================
// Transaction Log System - server.js
// All routes contained in this single file (MVC logic, no route files)
// ============================================================

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const pool = require('./config/db');

const app = express();
const PORT = 3000;

// ============================================================
// MIDDLEWARE
// ============================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'txlog-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// Auth middleware
const requireAuth = (req, res, next) => {
  if (!req.session.adminId) {
    return res.status(401).json({ success: false, message: 'Unauthorized. Please login.' });
  }
  next();
};

// Admin password verification middleware
const verifyAdminPassword = async (req, res, next) => {
  const { adminPassword } = req.body;
  if (!adminPassword) {
    return res.status(400).json({ success: false, message: 'Admin password required.' });
  }
  try {
    const [rows] = await pool.query('SELECT password_hash FROM admins WHERE id = ?', [req.session.adminId]);
    if (!rows.length) return res.status(401).json({ success: false, message: 'Admin not found.' });
    const match = await bcrypt.compare(adminPassword, rows[0].password_hash);
    if (!match) return res.status(403).json({ success: false, message: 'Incorrect admin password.' });
    next();
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ============================================================
// AUTH ROUTES
// ============================================================

// POST /login
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password required.' });
  }
  try {
    const [rows] = await pool.query('SELECT * FROM admins WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    const match = await bcrypt.compare(password, rows[0].password_hash);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    req.session.adminId = rows[0].id;
    req.session.adminUsername = rows[0].username;
    res.json({ success: true, message: 'Login successful.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /logout
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

// GET /api/me
app.get('/api/me', (req, res) => {
  if (!req.session.adminId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.adminUsername });
});

// POST /api/setup - Create initial admin (only if no admins exist)
app.post('/api/setup', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await pool.query('SELECT COUNT(*) as count FROM admins');
    if (rows[0].count > 0) {
      return res.status(400).json({ success: false, message: 'Admin already exists.' });
    }
    const hash = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO admins (username, password_hash) VALUES (?, ?)', [username, hash]);
    res.json({ success: true, message: 'Admin created.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// REPAIR ROUTES
// ============================================================

// GET /api/repairs - Get all repair transactions with joins
app.get('/api/repairs', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        rt.id, rt.quantity, rt.problem_description, rt.contact_number,
        rt.receive_date, rt.status, rt.created_at,
        o.office_name,
        pb.full_name AS brought_by_name, pb.role AS brought_by_role,
        p.product_name, p.serial_number, p.model_number,
        rb.full_name AS received_by_name, rb.role AS received_by_role,
        rd.repair_date, rd.repair_status, rd.comment,
        rp.full_name AS repair_person_name, rp.role AS repair_person_role,
        rel.release_date,
        rlt.full_name AS released_to_name,
        rlb.full_name AS released_by_name
      FROM repair_transactions rt
      JOIN offices o ON rt.office_id = o.id
      JOIN persons pb ON rt.brought_by_id = pb.id
      JOIN products p ON rt.product_id = p.id
      JOIN persons rb ON rt.received_by_id = rb.id
      LEFT JOIN repair_details rd ON rt.id = rd.repair_transaction_id
      LEFT JOIN persons rp ON rd.repair_person_id = rp.id
      LEFT JOIN release_details rel ON rt.id = rel.repair_transaction_id
      LEFT JOIN persons rlt ON rel.released_to_id = rlt.id
      LEFT JOIN persons rlb ON rel.released_by_id = rlb.id
      ORDER BY rt.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/repairs - Create repair transaction (Receive flow)
app.post('/api/repairs', requireAuth, async (req, res) => {
  const {
    office_name, brought_by_name, brought_by_role,
    product_name, serial_number, model_number,
    quantity, problem_description,
    received_by_name, received_by_role,
    contact_number, receive_date
  } = req.body;

  if (!office_name || !brought_by_name || !product_name || !received_by_name || !receive_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Upsert office
    await conn.query('INSERT IGNORE INTO offices (office_name) VALUES (?)', [office_name]);
    const [[office]] = await conn.query('SELECT id FROM offices WHERE office_name = ?', [office_name]);

    // Insert brought_by person
    const [bpResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [brought_by_name, brought_by_role || 'Employee']);

    // Insert product
    const [prodResult] = await conn.query('INSERT INTO products (product_name, serial_number, model_number) VALUES (?, ?, ?)', [product_name, serial_number || null, model_number || null]);

    // Insert received_by person
    const [rbResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [received_by_name, received_by_role || 'Employee']);

    // Insert repair transaction
    const [txResult] = await conn.query(`
      INSERT INTO repair_transactions 
        (office_id, brought_by_id, product_id, quantity, problem_description, received_by_id, contact_number, receive_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [office.id, bpResult.insertId, prodResult.insertId, quantity || 1, problem_description, rbResult.insertId, contact_number, receive_date]);

    await conn.commit();
    res.json({ success: true, message: 'Repair transaction created.', id: txResult.insertId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// PUT /api/repairs/:id/repair - Repair flow
app.put('/api/repairs/:id/repair', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { repair_person_name, repair_person_role, repair_date, repair_status, comment } = req.body;

  if (!repair_person_name || !repair_date || !repair_status) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rpResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [repair_person_name, repair_person_role || 'Employee']);

    // Check if repair_details already exist
    const [existing] = await conn.query('SELECT id FROM repair_details WHERE repair_transaction_id = ?', [id]);
    if (existing.length) {
      await conn.query(`
        UPDATE repair_details SET repair_person_id=?, repair_date=?, repair_status=?, comment=?
        WHERE repair_transaction_id=?
      `, [rpResult.insertId, repair_date, repair_status, comment, id]);
    } else {
      await conn.query(`
        INSERT INTO repair_details (repair_transaction_id, repair_person_id, repair_date, repair_status, comment)
        VALUES (?, ?, ?, ?, ?)
      `, [id, rpResult.insertId, repair_date, repair_status, comment]);
    }

    await conn.query('UPDATE repair_transactions SET status = ? WHERE id = ?', ['Repaired', id]);
    await conn.commit();
    res.json({ success: true, message: 'Repair details saved.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// PUT /api/repairs/:id/release - Release flow
app.put('/api/repairs/:id/release', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { released_to_name, released_by_name, release_date } = req.body;

  if (!released_to_name || !released_by_name || !release_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rtResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [released_to_name, 'Office Representative']);
    const [rbResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [released_by_name, 'Employee']);

    const [existing] = await conn.query('SELECT id FROM release_details WHERE repair_transaction_id = ?', [id]);
    if (existing.length) {
      await conn.query(`
        UPDATE release_details SET released_to_id=?, released_by_id=?, release_date=?
        WHERE repair_transaction_id=?
      `, [rtResult.insertId, rbResult.insertId, release_date, id]);
    } else {
      await conn.query(`
        INSERT INTO release_details (repair_transaction_id, released_to_id, released_by_id, release_date)
        VALUES (?, ?, ?, ?)
      `, [id, rtResult.insertId, rbResult.insertId, release_date]);
    }

    await conn.query('UPDATE repair_transactions SET status = ? WHERE id = ?', ['Released', id]);
    await conn.commit();
    res.json({ success: true, message: 'Item released.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// DELETE /api/repairs/:id
app.delete('/api/repairs/:id', requireAuth, verifyAdminPassword, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM repair_transactions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// BORROW ROUTES
// ============================================================

// GET /api/borrows
app.get('/api/borrows', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        bt.id, bt.item_name, bt.quantity, bt.borrow_date, bt.status, bt.created_at,
        b.full_name AS borrower_name,
        rb.full_name AS released_by_name,
        rd.return_date,
        rcv.full_name AS received_by_name
      FROM borrow_transactions bt
      JOIN persons b ON bt.borrower_id = b.id
      JOIN persons rb ON bt.released_by_id = rb.id
      LEFT JOIN return_details rd ON bt.id = rd.borrow_transaction_id
      LEFT JOIN persons rcv ON rd.received_by_id = rcv.id
      ORDER BY bt.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/borrows
app.post('/api/borrows', requireAuth, async (req, res) => {
  const { borrower_name, released_by_name, borrow_date, item_name, quantity } = req.body;

  if (!borrower_name || !released_by_name || !borrow_date || !item_name) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [borrowerResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [borrower_name, 'Borrower']);
    const [releasedByResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [released_by_name, 'Employee']);

    const [txResult] = await conn.query(`
      INSERT INTO borrow_transactions (borrower_id, released_by_id, item_name, quantity, borrow_date)
      VALUES (?, ?, ?, ?, ?)
    `, [borrowerResult.insertId, releasedByResult.insertId, item_name, quantity || 1, borrow_date]);

    await conn.commit();
    res.json({ success: true, message: 'Borrow transaction created.', id: txResult.insertId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// PUT /api/borrows/:id/return
app.put('/api/borrows/:id/return', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { received_by_name, return_date } = req.body;

  if (!received_by_name || !return_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rcvResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [received_by_name, 'Employee']);

    const [existing] = await conn.query('SELECT id FROM return_details WHERE borrow_transaction_id = ?', [id]);
    if (existing.length) {
      await conn.query('UPDATE return_details SET received_by_id=?, return_date=? WHERE borrow_transaction_id=?',
        [rcvResult.insertId, return_date, id]);
    } else {
      await conn.query('INSERT INTO return_details (borrow_transaction_id, received_by_id, return_date) VALUES (?, ?, ?)',
        [id, rcvResult.insertId, return_date]);
    }

    await conn.query('UPDATE borrow_transactions SET status = ? WHERE id = ?', ['Returned', id]);
    await conn.commit();
    res.json({ success: true, message: 'Item returned.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// DELETE /api/borrows/:id
app.delete('/api/borrows/:id', requireAuth, verifyAdminPassword, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM borrow_transactions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// SERVE FRONTEND
// ============================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`Transaction Log System running at http://localhost:${PORT}`);
});
