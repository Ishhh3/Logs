// ============================================================
// Transaction Log System - server.js
// Updated with Reservation + Tech4Ed + Dashboard routes
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

app.post('/logout', (req, res) => {
  req.session.destroy(() => { res.json({ success: true }); });
});

app.get('/api/me', (req, res) => {
  if (!req.session.adminId) return res.json({ loggedIn: false });
  res.json({ loggedIn: true, username: req.session.adminUsername });
});

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
    await conn.query('INSERT IGNORE INTO offices (office_name) VALUES (?)', [office_name]);
    const [[office]] = await conn.query('SELECT id FROM offices WHERE office_name = ?', [office_name]);
    const [bpResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [brought_by_name, brought_by_role || 'Employee']);
    const [prodResult] = await conn.query('INSERT INTO products (product_name, serial_number, model_number) VALUES (?, ?, ?)', [product_name, serial_number || null, model_number || null]);
    const [rbResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [received_by_name, received_by_role || 'Employee']);
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
    const [existing] = await conn.query('SELECT id FROM repair_details WHERE repair_transaction_id = ?', [id]);
    if (existing.length) {
      await conn.query(`UPDATE repair_details SET repair_person_id=?, repair_date=?, repair_status=?, comment=? WHERE repair_transaction_id=?`,
        [rpResult.insertId, repair_date, repair_status, comment, id]);
    } else {
      await conn.query(`INSERT INTO repair_details (repair_transaction_id, repair_person_id, repair_date, repair_status, comment) VALUES (?, ?, ?, ?, ?)`,
        [id, rpResult.insertId, repair_date, repair_status, comment]);
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
      await conn.query(`UPDATE release_details SET released_to_id=?, released_by_id=?, release_date=? WHERE repair_transaction_id=?`,
        [rtResult.insertId, rbResult.insertId, release_date, id]);
    } else {
      await conn.query(`INSERT INTO release_details (repair_transaction_id, released_to_id, released_by_id, release_date) VALUES (?, ?, ?, ?)`,
        [id, rtResult.insertId, rbResult.insertId, release_date]);
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

app.get('/api/borrows', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        bt.id, bt.item_name, bt.quantity, bt.borrow_date, bt.status, bt.created_at,
        bt.borrow_office,
        b.full_name AS borrower_name,
        rb.full_name AS released_by_name, rb.role AS released_by_role,
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

app.post('/api/borrows', requireAuth, async (req, res) => {
  const { borrower_name, released_by_name, released_by_role, borrow_date, item_name, quantity, borrow_office } = req.body;
  if (!borrower_name || !released_by_name || !borrow_date || !item_name) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [borrowerResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [borrower_name, 'Borrower']);
    const [releasedByResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [released_by_name, released_by_role || 'Employee']);
    const [txResult] = await conn.query(`
      INSERT INTO borrow_transactions (borrower_id, released_by_id, item_name, quantity, borrow_date, borrow_office)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [borrowerResult.insertId, releasedByResult.insertId, item_name, quantity || 1, borrow_date, borrow_office || null]);
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
// RESERVATION ROUTES
// ============================================================

app.get('/api/reservations', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        r.id, r.item_name, r.quantity, r.purpose,
        r.reservation_date, r.estimated_pickup_date, r.estimated_return_date,
        r.actual_pickup_date, r.actual_return_date,
        r.status, r.notes, r.created_at,
        p.full_name AS reserver_name, p.role AS reserver_role,
        o.office_name,
        ap.full_name AS approved_by_name,
        rp.full_name AS released_by_name,
        recv.full_name AS received_by_name
      FROM reservations r
      JOIN persons p ON r.reserver_id = p.id
      JOIN offices o ON r.office_id = o.id
      LEFT JOIN persons ap ON r.approved_by_id = ap.id
      LEFT JOIN persons rp ON r.released_by_id = rp.id
      LEFT JOIN persons recv ON r.received_by_id = recv.id
      ORDER BY r.created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.post('/api/reservations', requireAuth, async (req, res) => {
  const {
    reserver_name, reserver_role, office_name,
    item_name, quantity, purpose, notes,
    reservation_date, estimated_pickup_date, estimated_return_date
  } = req.body;

  if (!reserver_name || !office_name || !item_name || !reservation_date || !estimated_pickup_date || !estimated_return_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT IGNORE INTO offices (office_name) VALUES (?)', [office_name]);
    const [[office]] = await conn.query('SELECT id FROM offices WHERE office_name = ?', [office_name]);
    const [pResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [reserver_name, reserver_role || 'Employee']);
    const [rResult] = await conn.query(`
      INSERT INTO reservations (reserver_id, office_id, item_name, quantity, purpose, notes, reservation_date, estimated_pickup_date, estimated_return_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [pResult.insertId, office.id, item_name, quantity || 1, purpose, notes, reservation_date, estimated_pickup_date, estimated_return_date]);
    await conn.commit();
    res.json({ success: true, message: 'Reservation created.', id: rResult.insertId });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// PUT /api/reservations/:id/pick - Mark as picked up
app.put('/api/reservations/:id/pick', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { released_by_name, actual_pickup_date } = req.body;
  if (!released_by_name || !actual_pickup_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rpResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [released_by_name, 'Employee']);
    await conn.query('UPDATE reservations SET status=?, actual_pickup_date=?, released_by_id=? WHERE id=?',
      ['Picked', actual_pickup_date, rpResult.insertId, id]);
    await conn.commit();
    res.json({ success: true, message: 'Item marked as picked up.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

// PUT /api/reservations/:id/return - Mark as returned
app.put('/api/reservations/:id/return', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { received_by_name, actual_return_date } = req.body;
  if (!received_by_name || !actual_return_date) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rcvResult] = await conn.query('INSERT INTO persons (full_name, role) VALUES (?, ?)', [received_by_name, 'Employee']);
    await conn.query('UPDATE reservations SET status=?, actual_return_date=?, received_by_id=? WHERE id=?',
      ['Returned', actual_return_date, rcvResult.insertId, id]);
    await conn.commit();
    res.json({ success: true, message: 'Item marked as returned.' });
  } catch (err) {
    await conn.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  } finally {
    conn.release();
  }
});

app.delete('/api/reservations/:id', requireAuth, verifyAdminPassword, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM reservations WHERE id = ?', [id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// TECH4ED ROUTES
// ============================================================

app.get('/api/tech4ed', requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, user_name, gender, purpose, time_in, time_out,
        TIMESTAMPDIFF(SECOND, time_in, IFNULL(time_out, NOW())) AS duration_seconds,
        status, created_at
      FROM tech4ed_sessions
      ORDER BY created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.post('/api/tech4ed', requireAuth, async (req, res) => {
  const { user_name, gender, purpose } = req.body;
  if (!user_name || !gender || !purpose) {
    return res.status(400).json({ success: false, message: 'Required fields missing.' });
  }
  try {
    const [result] = await pool.query(`
      INSERT INTO tech4ed_sessions (user_name, gender, purpose, time_in, status)
      VALUES (?, ?, ?, NOW(), 'Active')
    `, [user_name, gender, purpose]);
    res.json({ success: true, message: 'Session started.', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.put('/api/tech4ed/:id/end', requireAuth, async (req, res) => {
  const { id } = req.params;
  try {
    const [[session]] = await pool.query('SELECT * FROM tech4ed_sessions WHERE id = ?', [id]);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found.' });
    if (session.status === 'Ended') return res.status(400).json({ success: false, message: 'Session already ended.' });
    await pool.query('UPDATE tech4ed_sessions SET time_out = NOW(), status = ? WHERE id = ?', ['Ended', id]);
    const [[updated]] = await pool.query('SELECT TIMESTAMPDIFF(SECOND, time_in, time_out) AS duration_seconds FROM tech4ed_sessions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Session ended.', duration_seconds: updated.duration_seconds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

app.delete('/api/tech4ed/:id', requireAuth, verifyAdminPassword, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM tech4ed_sessions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Record deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ============================================================
// DASHBOARD STATS
// ============================================================

app.get('/api/dashboard', requireAuth, async (req, res) => {
  try {
    const [[repairStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_repair,
        SUM(status IN ('Received','Repaired')) AS pending_repair,
        SUM(status = 'Released') AS total_released,
        SUM(rd.repair_status = 'Fixed') AS total_fixed,
        SUM(rd.repair_status = 'Unserviceable') AS total_unserviceable
      FROM repair_transactions rt
      LEFT JOIN repair_details rd ON rt.id = rd.repair_transaction_id
    `);

    const [[borrowStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_borrow,
        SUM(status = 'Borrowed') AS pending_return,
        SUM(status = 'Returned') AS total_returned
      FROM borrow_transactions
    `);

    const [[reservationStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_reservations,
        SUM(status = 'Reserved') AS pending_reservations,
        SUM(status = 'Picked') AS active_reservations,
        SUM(status = 'Returned') AS completed_reservations
      FROM reservations
    `);

    const [[tech4edStats]] = await pool.query(`
      SELECT
        COUNT(*) AS total_sessions,
        SUM(status = 'Active') AS active_sessions,
        SUM(status = 'Ended') AS ended_sessions
      FROM tech4ed_sessions
    `);

    // Repair success rate by month (last 6 months)
    const [repairByMonth] = await pool.query(`
      SELECT 
        DATE_FORMAT(rt.receive_date, '%b %Y') AS month,
        DATE_FORMAT(rt.receive_date, '%Y-%m') AS month_sort,
        COUNT(*) AS total,
        SUM(rd.repair_status = 'Fixed') AS fixed,
        SUM(rd.repair_status = 'Unserviceable') AS unserviceable
      FROM repair_transactions rt
      LEFT JOIN repair_details rd ON rt.id = rd.repair_transaction_id
      WHERE rt.receive_date >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY month, month_sort
      ORDER BY month_sort ASC
    `);

    // Office repair frequency (top 10)
    const [officeRepairs] = await pool.query(`
      SELECT o.office_name, COUNT(*) AS total
      FROM repair_transactions rt
      JOIN offices o ON rt.office_id = o.id
      GROUP BY o.office_name
      ORDER BY total DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        repair: repairStats,
        borrow: borrowStats,
        reservation: reservationStats,
        tech4ed: tech4edStats,
        repairByMonth,
        officeRepairs
      }
    });
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
// AUTO-MIGRATION: Add missing columns/tables on startup
// ============================================================
async function runMigrations() {
  const conn = await pool.getConnection();
  try {
    // Add borrow_office to borrow_transactions if missing
    await conn.query(`
      ALTER TABLE borrow_transactions
      ADD COLUMN IF NOT EXISTS borrow_office VARCHAR(200)
    `).catch(() => {
      // MySQL < 8.0 doesn't support IF NOT EXISTS on ALTER — use workaround
      return conn.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'borrow_transactions'
          AND COLUMN_NAME = 'borrow_office'
      `).then(([rows]) => {
        if (!rows.length) {
          return conn.query(`ALTER TABLE borrow_transactions ADD COLUMN borrow_office VARCHAR(200)`);
        }
      });
    });

    // Create reservations table if missing
    await conn.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reserver_id INT NOT NULL,
        office_id INT NOT NULL,
        item_name VARCHAR(200) NOT NULL,
        quantity INT NOT NULL DEFAULT 1,
        purpose TEXT,
        notes TEXT,
        reservation_date DATE NOT NULL,
        estimated_pickup_date DATE NOT NULL,
        estimated_return_date DATE NOT NULL,
        actual_pickup_date DATE,
        actual_return_date DATE,
        released_by_id INT,
        received_by_id INT,
        approved_by_id INT,
        status ENUM('Reserved','Picked','Returned','Cancelled') NOT NULL DEFAULT 'Reserved',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reserver_id) REFERENCES persons(id),
        FOREIGN KEY (office_id) REFERENCES offices(id)
      )
    `);

    // Create tech4ed_sessions table if missing
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tech4ed_sessions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_name VARCHAR(200) NOT NULL,
        gender ENUM('Male','Female','Other') NOT NULL,
        purpose VARCHAR(500) NOT NULL,
        time_in DATETIME NOT NULL,
        time_out DATETIME,
        status ENUM('Active','Ended') NOT NULL DEFAULT 'Active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Migrations complete.');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    conn.release();
  }
}

app.listen(PORT, async () => {
  console.log(`Transaction Log System running at http://localhost:${PORT}`);
  await runMigrations();
});