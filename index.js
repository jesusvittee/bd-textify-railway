const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión
const dbConfig = {
    host: process.env.MYSQLHOST,
    user: process.env.MYSQLUSER,
    password: process.env.MYSQLPASSWORD,
    database: process.env.MYSQLDATABASE,
    port: process.env.MYSQLPORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

// Función para inicializar la base de datos
async function initDb() {
    console.log("⏳ Iniciando verificación de base de datos...");
    try {
        const conn = await pool.getConnection();
        console.log("📡 Conexión exitosa a MySQL.");

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

        console.log("✅ Tablas verificadas/creadas correctamente.");
        conn.release();
    } catch (err) {
        console.error("❌ ERROR AL INICIALIZAR DB:", err.message);
        console.log("💡 Revisa que las variables en Railway coincidan con tu base de datos.");
    }
}

// Ejecutar inicialización
initDb();

app.get('/', (req, res) => res.send('🚀 Servidor Textify en línea'));

// Registro
app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString();
    try {
        console.log(`Intentando registrar a: ${correo}`);
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        res.json({ token: "token_ok", userId: id, nombre: nombre });
    } catch (err) {
        console.error("❌ Error en Registro:", err.message);
        res.status(500).json({ error: "Error al guardar en la base de datos: " + err.message });
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
            res.status(401).json({ error: "Correo o contraseña incorrectos" });
        }
    } catch (err) {
        console.error("❌ Error en Login:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 Servidor listo en puerto ${PORT}`));