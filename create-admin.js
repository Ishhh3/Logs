// Helper script to create admin account
// Usage: node create-admin.js <username> <password>

const bcrypt = require('bcrypt');

const [,, username, password] = process.argv;

if (!username || !password) {
  console.log('Usage: node create-admin.js <username> <password>');
  process.exit(1);
}

bcrypt.hash(password, 10).then(hash => {
  console.log('\n✅ Run this SQL in phpMyAdmin:\n');
  console.log(`INSERT INTO admins (username, password_hash) VALUES ('${username}', '${hash}');\n`);
}).catch(err => {
  console.error('Error:', err.message);
});
