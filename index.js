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
    ssl: { rejectUnauthorized: false },
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
            updatedAt BIGINT,
            INDEX(usuarioId)
        )`);

        await conn.query(`CREATE TABLE IF NOT EXISTS conversations (
            id VARCHAR(255) PRIMARY KEY, 
            usuarioId VARCHAR(255), 
            participantName VARCHAR(255), 
            lastMessage TEXT, 
            lastMessageTime BIGINT, 
            estado VARCHAR(255), 
            isPinned BOOLEAN, 
            updatedAt BIGINT,
            INDEX(usuarioId)
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
    const id = Date.now().toString(); // Generamos el PK único para este usuario
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        console.log(`👤 Nuevo usuario registrado: ${correo} (ID: ${id})`);
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
            const user = rows[0];
            console.log(`🔑 Login exitoso: ${user.correo} (ID: ${user.id})`);
            res.json({ token: "token_ok", userId: user.id, nombre: user.nombre });
        } else {
            res.status(401).json({ error: "Credenciales inválidas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SINCRONIZACIÓN: SUBIR (ESPEJO TOTAL EN NUBE) ---
app.post('/api/sync/push', async (req, res) => {
    const { userId, phrases, conversations } = req.body;
    
    // Identificamos al usuario. Si no viene en el body, lo buscamos en los objetos.
    const finalUserId = userId || (phrases && phrases[0]?.usuarioId) || (conversations && conversations[0]?.usuarioId);

    if (!finalUserId || finalUserId === "default_user") {
        console.log("⚠️ Intento de sincronización bloqueado: ID inválido o genérico.");
        return res.status(400).json({ error: "Falta identificación de usuario real." });
    }

    console.log(`🔄 PUSH (Espejo): Reemplazando datos en nube para usuario ${finalUserId}`);
    
    try {
        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            // 1. Limpieza total de lo que este usuario tenía en la nube
            await conn.query('DELETE FROM phrases WHERE usuarioId = ?', [finalUserId]);
            await conn.query('DELETE FROM conversations WHERE usuarioId = ?', [finalUserId]);

            // 2. Inserción de lo nuevo forzando el userId correcto
            if (phrases && phrases.length > 0) {
                for (const p of phrases) {
                    await conn.query('INSERT INTO phrases (id, usuarioId, text, categoria, isPinned, updatedAt) VALUES (?, ?, ?, ?, ?, ?)', 
                    [p.id, finalUserId, p.text, p.categoria, p.isPinned, p.updatedAt]);
                }
            }
            if (conversations && conversations.length > 0) {
                for (const c of conversations) {
                    await conn.query('INSERT INTO conversations (id, usuarioId, participantName, lastMessage, lastMessageTime, estado, isPinned, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
                    [c.id, finalUserId, c.participantName, c.lastMessage, c.lastMessageTime, c.estado, c.isPinned, c.updatedAt]);
                }
            }

            await conn.commit();
            console.log(`✅ PUSH exitoso: Nube actualizada para usuario ${finalUserId}`);
            res.json({ success: true, timestamp: Date.now() });
        } catch (dbErr) {
            await conn.rollback();
            throw dbErr;
        } finally {
            conn.release();
        }
    } catch (err) {
        console.error("❌ Error en PUSH:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// --- SINCRONIZACIÓN: BAJAR (ESPEJO TOTAL EN APP) ---
app.get('/api/sync/pull', async (req, res) => {
    const userId = req.query.userId;
    
    if (!userId || userId === "default_user") {
        return res.status(400).json({ error: "Se requiere un ID de usuario real para descargar." });
    }
    
    console.log(`📤 PULL: Buscando datos guardados para usuario: ${userId}`);
    
    try {
        // Traemos todo lo que este usuario específico tenga en la nube
        const [phrases] = await pool.query('SELECT * FROM phrases WHERE usuarioId = ?', [userId]);
        const [convs] = await pool.query('SELECT * FROM conversations WHERE usuarioId = ?', [userId]);
        
        console.log(`✅ PULL exitoso: Enviando ${phrases.length} frases y ${convs.length} chats a usuario ${userId}`);
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
    console.log(`🚀 Servidor Textify dinámico listo en puerto ${PORT}`);
});