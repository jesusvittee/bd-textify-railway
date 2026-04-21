const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Configuración de conexión a MySQL con soporte SSL para Railway
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

// Inicializar base de datos y crear tablas
async function initDb() {
    console.log("⏳ Verificando estructura de tablas en la base de datos...");
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

        await conn.query(`CREATE TABLE IF NOT EXISTS messages (
            id VARCHAR(255) PRIMARY KEY,
            conversationId VARCHAR(255),
            text TEXT,
            isOwn BOOLEAN,
            timestamp BIGINT,
            INDEX(conversationId)
        )`);

        console.log("✅ Servidor vinculado a MySQL. Estructura lista.");
        conn.release();
    } catch (err) {
        console.error("❌ ERROR AL INICIALIZAR DB:", err.message);
    }
}
initDb();

app.get('/', (req, res) => res.send('🚀 Backend de Textify operando correctamente'));

// --- AUTENTICACIÓN ---

app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString(); 
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        res.json({ token: "session_token_active", userId: id, nombre: nombre });
    } catch (err) {
        res.status(500).json({ error: "El correo ya existe o error de servidor" });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { correo, contrasena } = req.body;
    try {
        const [rows] = await pool.query('SELECT * FROM usuarios WHERE correo = ? AND contrasena = ?', [correo, contrasena]);
        if (rows.length > 0) {
            const user = rows[0];
            res.json({ token: "session_token_active", userId: user.id, nombre: user.nombre });
        } else {
            res.status(401).json({ error: "Credenciales incorrectas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- RUTA DE LIMPIEZA (CLEAR) ---
// Esta es la ruta que el móvil llama para vaciar antes de subir
app.delete('/api/sync/clear/:userId', async (req, res) => {
    const { userId } = req.params;
    console.log(`🗑️ Vaciando datos para usuario: ${userId}`);
    try {
        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            // ORDEN CORRECTO: Primero hijos (mensajes), luego padres (conversaciones)
            await conn.query('DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE usuarioId = ?)', [userId]);
            await conn.query('DELETE FROM conversations WHERE usuarioId = ?', [userId]);
            await conn.query('DELETE FROM phrases WHERE usuarioId = ?', [userId]);
            
            await conn.commit();
            res.json({ success: true, message: "Nube vaciada" });
        } catch (dbErr) {
            await conn.rollback();
            throw dbErr;
        } finally {
            conn.release();
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SUBIR (PUSH) ---
app.post('/api/sync/push', async (req, res) => {
    const { userId, phrases, conversations, messages } = req.body;
    
    if (!userId || userId === "default_user") {
        return res.status(400).json({ error: "ID de usuario inválido" });
    }

    console.log(`🔄 PUSH (Espejo): Sincronizando para usuario ${userId}`);
    
    try {
        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            // 1. Borramos en el ORDEN CORRECTO para evitar dejar huérfanos
            // Primero mensajes (dependen de conversations)
            await conn.query('DELETE FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE usuarioId = ?)', [userId]);
            // Luego conversaciones y frases
            await conn.query('DELETE FROM conversations WHERE usuarioId = ?', [userId]);
            await conn.query('DELETE FROM phrases WHERE usuarioId = ?', [userId]);

            // 2. Insertamos lo nuevo
            if (phrases) {
                for (const p of phrases) {
                    await conn.query('INSERT INTO phrases VALUES (?, ?, ?, ?, ?, ?)', 
                    [p.id, userId, p.text, p.categoria, p.isPinned, p.updatedAt]);
                }
            }

            if (conversations) {
                for (const c of conversations) {
                    await conn.query('INSERT INTO conversations VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 
                    [c.id, userId, c.participantName, c.lastMessage, c.lastMessageTime, c.estado, c.isPinned, c.updatedAt]);
                }
            }

            if (messages) {
                for (const m of messages) {
                    await conn.query('INSERT INTO messages VALUES (?, ?, ?, ?, ?)', 
                    [m.id, m.conversationId, m.text, m.isOwn, m.timestamp]);
                }
            }

            await conn.commit();
            res.json({ success: true });
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

// --- BAJAR (PULL) ---
app.get('/api/sync/pull', async (req, res) => {
    const { userId } = req.query;
    try {
        const [phrases] = await pool.query('SELECT * FROM phrases WHERE usuarioId = ?', [userId]);
        const [convs] = await pool.query('SELECT * FROM conversations WHERE usuarioId = ?', [userId]);
        const [msgs] = await pool.query('SELECT * FROM messages WHERE conversationId IN (SELECT id FROM conversations WHERE usuarioId = ?)', [userId]);
        
        res.json({ phrases, conversations: convs, messages: msgs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor operando en puerto ${PORT}`);
});