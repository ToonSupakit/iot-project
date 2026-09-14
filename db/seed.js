const mysql = require('mysql2');
const bcrypt = require('bcryptjs');

const db = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'smart_air_db'
});

async function seed() {
    db.connect(async err => {
        if (err) {
            console.error('❌ Connection failed:', err.message);
            process.exit(1);
        }
        console.log('✅ Connected to MySQL database!');

        const adminHash = await bcrypt.hash('adminpassword123', 10);
        const userHash = await bcrypt.hash('userpassword123', 10);

        db.query(
            `INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role)`,
            ['AdminUser', 'admin@airwatch.com', adminHash, 'admin'],
            err => {
                if (err) console.error('❌ Admin insert error:', err.message);
                else console.log('✅ Admin account: admin@airwatch.com / adminpassword123');

                db.query(
                    `INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
                    ['DemoUser', 'user@airwatch.com', userHash, 'user'],
                    err => {
                        if (err) console.error('❌ User insert error:', err.message);
                        else console.log('✅ User account: user@airwatch.com / userpassword123');
                        db.end();
                    }
                );
            }
        );
    });
}

seed();
