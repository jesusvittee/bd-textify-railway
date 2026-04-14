const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

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
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Crear tablas si no existen
async function initDb() {
    try {
        const conn = await pool.getConnection();
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (id VARCHAR(255) PRIMARY KEY, nombre VARCHAR(255), correo VARCHAR(255) UNIQUE, contrasena VARCHAR(255), fechaRegistro BIGINT, updatedAt BIGINT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), text TEXT, categoria VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (id VARCHAR(255) PRIMARY KEY, usuarioId VARCHAR(255), participantName VARCHAR(255), lastMessage TEXT, lastMessageTime BIGINT, estado VARCHAR(255), isPinned BOOLEAN, updatedAt BIGINT)`);
        conn.release();
        console.log("✅ Base de datos MySQL vinculada y tablas listas");
    } catch (err) {
        console.error("❌ Error inicializando DB:", err.message);
    }
}
initDb();

// Ruta de prueba (RAÍZ) - Muy importante para el Health Check de Railway
app.get('/', (_, res) => {
    res.send('🚀 Servidor de Textify operando correctamente');
});

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
// --- NUEVOS ENDPOINTS DE AUTENTICACIÓN ---

// Registro de usuario
app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString(); // Generamos un ID simple
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)', 
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        // Enviamos la respuesta que la App espera
        res.json({ 
            token: "token_generado_exitosamente", 
            userId: id, 
            nombre: nombre 
        });
    } catch (err) {
        console.error("Error en registro:", err.message);
        res.status(500).json({ error: "El correo ya está registrado o hubo un error en el servidor" });
    }
});

// Inicio de sesión
app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ? AND contrasena = ?', [correo, contrasena]);
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ 
                token: "token_generado_exitosamente", 
                userId: user.id, 
                nombre: user.nombre 
            });
        } else {
            res.status(401).json({ error: "Correo o contraseña incorrectos" });
        }
    } catch (err) {
        console.error("Error en login:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------

// USAR EL PUERTO QUE RAILWAY ASIGNA O EL 3000 POR DEFECTO
const PORT = process.env.PORT || 3000;

// IMPORTANTE: Escuchar en '0.0.0.0'
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Textify en puerto ${PORT}`);
});