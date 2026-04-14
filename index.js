const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión a MySQL con SSL para Railway
const dbConfig = {
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
};

const pool = mysql.createPool(dbConfig);

// Inicializar base de datos y tablas
async function initDb() {
    console.log("⏳ Verificando tablas en la base de datos...");
    try {
        const conn = await pool.getConnection();
        
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (
            id VARCHAR(255) PRIMARY KEY, 
            nombre VARCHAR(255), 
            correo VARCHAR(255) UNIQUE, 
            contrasena VARCHAR(255), 
            fechaRegistro BIGINT, 
            updatedAt BIGINT
        )`);

        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (
            id VARCHAR(255) PRIMARY KEY, 
            usuarioId VARCHAR(255), 
            text TEXT, 
            categoria VARCHAR(255), 
            isPinned BOOLEAN, 
            updatedAt BIGINT
        )`);

        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (
            id VARCHAR(255) PRIMARY KEY, 
            usuarioId VARCHAR(255), 
            participantName VARCHAR(255), 
            lastMessage TEXT, 
            lastMessageTime BIGINT, 
            estado VARCHAR(255), 
            isPinned BOOLEAN, 
            updatedAt BIGINT
        )`);

        console.log("✅ Servidor listo y conectado a MySQL");
        conn.release();
    } catch (err) {
        console.error("❌ Error al iniciar DB:", err.message);
    }
}
initDb();

app.get('/', (req, res) => res.send('🚀 Servidor Textify Operativo'));

// --- AUTENTICACIÓN ---

app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString();
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        console.log(`👤 Registro nuevo: ${correo}`);
        res.json({ token: "token_ok", userId: id, nombre: nombre });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ? AND contrasena = ?', [correo, contrasena]);
        if (rows.length > 0) {
            console.log(`🔑 Login: ${correo}`);
            res.json({ token: "token_ok", userId: rows[0].id, nombre: rows[0].nombre });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SINCRONIZACIÓN: SUBIR (PUSH) ---
app.post('/api/sync/push', async (req, res) => {
    const { phrases, conversations } = req.body;
    console.log(`📥 PUSH: Recibidas ${phrases?.length || 0} frases y ${conversations?.length || 0} chats`);
    
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
        console.log("✅ PUSH completado con éxito");
        res.json({ success: true, timestamp: Date.now() });
    } catch (err) {
        console.error("❌ Error en PUSH:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- SINCRONIZACIÓN: BAJAR (PULL) ---
app.get('/api/sync/pull', async (req, res) => {
    const lastSync = req.query.lastSync || 0;
    console.log(`📤 PULL: Buscando datos nuevos desde timestamp: ${lastSync}`);
    
    try {
        const [phrases] = await pool.query('SELECT * FROM phrases WHERE updatedAt > ?', [lastSync]);
        const [convs] = await pool.query('SELECT * FROM conversations WHERE updatedAt > ?', [lastSync]);
        
        console.log(`✅ PULL: Enviando ${phrases.length} frases y ${convs.length} chats a la App`);
        res.json({ 
            phrases: phrases, 
            conversations: convs 
        });
    } catch (err) {
        console.error("❌ Error en PULL:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Textify listo en puerto ${PORT}`);
});
