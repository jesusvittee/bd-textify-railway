const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());// Conexión mejorada con soporte SSL para Railway
const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    ssl: {
        rejectUnauthorized: false
    },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Inicializar DB con logs de error más claros
async function initDb() {
    try {
        const conn = await pool.getConnection();
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (id VARCHAR(255) PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255) UNIQUE, contrasena VARCHAR(255), fechaRegistro BIGINT, updatedAt BIGINT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), text TEXT, categoria VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), participantName VARCHAR(255), lastMessage TEXT, lastMessageTime BIGINT, estado VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        conn.release();
        console.log("✅ MySQL conectado y tablas verificadas");
    } catch (err) {
        console.error("❌ Error de conexión DB:", err.message);
    }
}
initDb();

app.get('/', (_, res) => res.send('🚀 Servidor Textify Activo'));

// Registro
app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString();
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        res.json({ token: "token_ok", userId: id, nombre: nombre });
    } catch (err) {
        console.error("❌ Error Registro:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ? AND contrasena = ?', [correo, contrasena]);
        if (rows.length > 0) {
            res.json({ token: "token_ok", userId: rows[0].id, nombre: rows[0].nombre });
        } else {
            res.status(401).json({ error: "Credenciales incorrectas" });
        }
    } catch (err) {
        console.error("❌ Error Login:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Sync Push
app.post('/api/sync/push', async (req, res) => {
    const { phrases, conversations } = req.body;
    try {
        if (phrases) {
            for (const p of phrases) {
                await pool.query('INSERT INTO phrases (id, usuarioId, text, categoria, isPinned, updatedAt) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE text=VALUES(text), categoria=VALUES(categoria), isPinned=VALUES(isPinned), updatedAt=VALUES(updatedAt)', 
                [p.id, p.usuarioId, p.text, p.categoria, p.isPinned, p.updatedAt]);
            }
        }
        if (conversations) {
            for (const c of conversations) {
                await pool.query('INSERT INTO conversations (id, usuarioId, participantName, lastMessage, lastMessageTime, estado, isPinned, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE lastMessage=VALUES(lastMessage), lastMessageTime=VALUES(lastMessageTime), participantName=VALUES(participantName), estado=VALUES(estado), isPinned=VALUES(isPinned), updatedAt=VALUES(updatedAt)', 
                [c.id, c.usuarioId, c.participantName, c.lastMessage, c.lastMessageTime, c.estado, c.isPinned, c.updatedAt]);
            }
        }
        res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Puerto: ${PORT}`));