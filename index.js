const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MySQL usando las variables que Railway te da automáticamente
const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
});

// Crear tablas si no existen al iniciar
async function initDb() {
    try {
        const conn = await pool.getConnection();
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (id VARCHAR(255) PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255) UNIQUE, contrasena VARCHAR(255))`);
        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), text TEXT, isPinned BOOLEAN)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), participantName VARCHAR(255), lastMessage TEXT, lastMessageTime BIGINT)`);
        conn.release();
        console.log("✅ Base de datos MySQL vinculada y tablas listas");
    } catch (err) {
        console.error("❌ Error conectando a MySQL:", err.message);
    }
}
initDb();

// Endpoint para recibir datos de la App (Push)
app.post('/api/sync/push', async (req, res) => {
    const { phrases, conversations } = req.body;
    try {
        if (phrases) {
            for (const p of phrases) {
                await pool.query('INSERT INTO phrases (id, usuarioId, text, isPinned) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE text=VALUES(text)', [p.id, "default_user", p.text, p.isPinned]);
            }
        }
        if (conversations) {
            for (const c of conversations) {
                await pool.query('INSERT INTO conversations (id, usuarioId, participantName, lastMessage, lastMessageTime) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE lastMessage=VALUES(lastMessage)', [c.id, "default_user", c.participantName, c.lastMessage, c.lastMessageTime]);
            }
        }
        res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Servidor Textify en puerto ${PORT}`));