-- ============================================================
-- Transaction Log System - 3NF Database Schema
-- Run this in phpMyAdmin or MySQL CLI
-- ============================================================

CREATE DATABASE IF NOT EXISTS transaction_log_db;
USE transaction_log_db;

-- ============================================================
-- TABLE: admins
-- ============================================================
CREATE TABLE IF NOT EXISTS admins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- TABLE: offices
-- ============================================================
CREATE TABLE IF NOT EXISTS offices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  office_name VARCHAR(200) NOT NULL UNIQUE
);

-- ============================================================
-- TABLE: persons
-- ============================================================
CREATE TABLE IF NOT EXISTS persons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(200) NOT NULL,
  role ENUM('Employee', 'OJT', 'Borrower', 'Office Representative') NOT NULL DEFAULT 'Employee'
);

-- ============================================================
-- TABLE: products
-- ============================================================
CREATE TABLE IF NOT EXISTS products (
  id INT AUTO_INCREMENT PRIMARY KEY,
  product_name VARCHAR(200) NOT NULL,
  serial_number VARCHAR(200),
  model_number VARCHAR(200)
);

-- ============================================================
-- TABLE: repair_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS repair_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  office_id INT NOT NULL,
  brought_by_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  problem_description TEXT,
  received_by_id INT NOT NULL,
  contact_number VARCHAR(50),
  receive_date DATE NOT NULL,
  status ENUM('Received', 'Repaired', 'Released') NOT NULL DEFAULT 'Received',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (office_id) REFERENCES offices(id),
  FOREIGN KEY (brought_by_id) REFERENCES persons(id),
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (received_by_id) REFERENCES persons(id)
);

-- ============================================================
-- TABLE: repair_details
-- ============================================================
CREATE TABLE IF NOT EXISTS repair_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  repair_transaction_id INT NOT NULL UNIQUE,
  repair_person_id INT NOT NULL,
  repair_date DATE NOT NULL,
  repair_status ENUM('Fixed', 'Unserviceable') NOT NULL,
  comment TEXT,
  FOREIGN KEY (repair_transaction_id) REFERENCES repair_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (repair_person_id) REFERENCES persons(id)
);

-- ============================================================
-- TABLE: release_details
-- ============================================================
CREATE TABLE IF NOT EXISTS release_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  repair_transaction_id INT NOT NULL UNIQUE,
  released_to_id INT NOT NULL,
  released_by_id INT NOT NULL,
  release_date DATE NOT NULL,
  FOREIGN KEY (repair_transaction_id) REFERENCES repair_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (released_to_id) REFERENCES persons(id),
  FOREIGN KEY (released_by_id) REFERENCES persons(id)
);

-- ============================================================
-- TABLE: borrow_transactions
-- ============================================================
CREATE TABLE IF NOT EXISTS borrow_transactions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  borrower_id INT NOT NULL,
  released_by_id INT NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  borrow_date DATE NOT NULL,
  status ENUM('Borrowed', 'Returned') NOT NULL DEFAULT 'Borrowed',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (borrower_id) REFERENCES persons(id),
  FOREIGN KEY (released_by_id) REFERENCES persons(id)
);

-- ============================================================
-- TABLE: return_details
-- ============================================================
CREATE TABLE IF NOT EXISTS return_details (
  id INT AUTO_INCREMENT PRIMARY KEY,
  borrow_transaction_id INT NOT NULL UNIQUE,
  received_by_id INT NOT NULL,
  return_date DATE NOT NULL,
  FOREIGN KEY (borrow_transaction_id) REFERENCES borrow_transactions(id) ON DELETE CASCADE,
  FOREIGN KEY (received_by_id) REFERENCES persons(id)
);

-- ============================================================
-- SAMPLE ADMIN INSERT (password: admin123)
-- Run after schema creation
-- ============================================================
-- INSERT INTO admins (username, password_hash) VALUES
-- ('admin', '$2b$10$YourBcryptHashHere');
-- Note: Use the setup script or /api/setup endpoint to create admin
