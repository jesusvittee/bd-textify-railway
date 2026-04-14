const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexión a MySQL usando las variables de Railway
const pool = mysql.createPool({
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
});

// Crear tablas con la estructura completa de la App
async function initDb() {
    try {
        const conn = await pool.getConnection();
        // Tabla Usuarios
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (id VARCHAR(255) PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255) UNIQUE, contrasena VARCHAR(255), fechaRegistro BIGINT, updatedAt BIGINT)`);
        // Tabla Frases (Añadimos categoria y updatedAt)
        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), text TEXT, categoria VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        // Tabla Conversaciones (Añadimos estado, isPinned y updatedAt)
        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), participantName VARCHAR(255), lastMessage TEXT, lastMessageTime BIGINT, estado VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        
        conn.release();
        console.log("✅ Base de datos MySQL sincronizada y tablas listas");
    } catch (err) {
        console.error("❌ Error en la base de datos:", err.message);
    }
}
initDb();

// Endpoint para recibir datos de la App (Push)
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
        console.error("Error en sincronización:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;

// Ruta de prueba (Usamos _ para indicar que req no se usa)
app.get('/', (_, res) => {
    res.send('🚀 Servidor de Textify operando correctamente');
});

app.listen(PORT, () => console.log(`🚀 Servidor Textify en puerto ${PORT}`));