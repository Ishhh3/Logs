# 🖥️ Transaction Log System — Setup Guide

## Prerequisites
- **XAMPP** (Apache + MySQL running)
- **Node.js** v16+ installed
- A terminal / command prompt

---

## Step 1: Database Setup (phpMyAdmin)

1. Open **http://localhost/phpmyadmin**
2. Click **New** → Create database named: `transaction_log_db`
3. Select the database, click **SQL** tab
4. Copy and paste all contents of `schema.sql` → Click **Go**

---

## Step 2: Install Dependencies

```bash
cd transaction-log
npm install
```

> ✅ No deprecation warnings — `bcryptjs` (pure JS) replaces `bcrypt` (native addon),
> eliminating all transitive warnings from `glob`, `rimraf`, `tar`, `npmlog`, etc.

---

## Step 3: Start the Server

```bash
npm start
```

Open browser: **http://localhost:3000**

---

## Step 4: Create Admin Account

1. On the login page, click **"First time? Create admin"**
2. Enter your desired username and password
3. Click **Create Admin**
4. Login with your credentials

> ⚠️ Admin creation is only allowed once (when no admins exist).

---

## Alternative: Manual Admin Insert

Run this in phpMyAdmin SQL tab (replace the hash):

```sql
-- First generate a bcrypt hash using Node.js:
-- node -e "const b=require('bcryptjs'); b.hash('yourpassword',10).then(h=>console.log(h))"

INSERT INTO admins (username, password_hash) 
VALUES ('admin', '$2b$10$YOUR_BCRYPT_HASH_HERE');
```

Or use the included helper script:
```bash
node create-admin.js admin yourpassword
```

---

## Project Structure

```
transaction-log/
├── server.js          ← All backend routes + logic
├── package.json
├── schema.sql         ← Run this in phpMyAdmin
├── config/
│   └── db.js          ← MySQL connection pool
└── public/
    └── index.html     ← Full frontend (HTML + Tailwind + JS)
```

---

## What Changed (Vulnerability Fix)

| Before | After |
|--------|-------|
| `bcrypt@5.1.1` (native C++ addon) | `bcryptjs@2.4.3` (pure JavaScript) |

`bcrypt` pulled in `@mapbox/node-pre-gyp` which depended on old, deprecated packages
(`glob@7`, `rimraf@3`, `tar@6`, `npmlog`, `gauge`, `are-we-there-yet`, `inflight`).
`bcryptjs` is a pure JS drop-in replacement — identical API, same hash format ($2b$),
no native build step, no deprecated sub-dependencies.

---

## Usage Guide

### 🛠 Repair Log
1. Click **"+ Receive Item"** to log incoming repair
2. Click **Repair** on a received item to log repair details
3. Click **Release** on a repaired item to release it to the owner
4. Completed items move to **History**

### 📦 Borrow Log
1. Click **"+ New Borrow"** to log borrowed items
2. New borrows automatically appear in **Pending**
3. Click **Return** when item is returned
4. Returned items move to **History**

### ⏳ Pending Tab
- Shows all items awaiting repair, release, or return
- Action buttons change based on current status

### 📜 History Tab
- Shows all completed repairs and returns
- Click **View** for full details
- Click **Del** (requires admin password) to delete

---

## Security Notes
- All passwords are bcrypt hashed (cost factor 10) via `bcryptjs`
- Sessions expire after 24 hours
- Delete operations require re-entering admin password
- All SQL uses parameterized queries (SQL injection safe)
- All routes are protected by authentication middleware
