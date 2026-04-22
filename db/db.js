const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'smart_air_db'
});
module.exports = db;