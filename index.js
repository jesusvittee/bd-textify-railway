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

// Inicializar base de datos y crear tablas dinámicas
async function initDb() {
    console.log("⏳ Verificando estructura de tablas...");
    try {
        const conn = await pool.getConnection();
        
        // Tabla Usuarios: Almacena el PK único de cada persona
        await conn.query(`CREATE TABLE IF NOT EXISTS usuarios (
            id VARCHAR(255) PRIMARY KEY, 
            nombre VARCHAR(255), 
            correo VARCHAR(255) UNIQUE, 
            contrasena VARCHAR(255), 
            fechaRegistro BIGINT, 
            updatedAt BIGINT
        )`);

        // Tabla Frases: Vinculada al usuarioId
        await conn.query(`CREATE TABLE IF NOT EXISTS phrases (
            id VARCHAR(255) PRIMARY KEY, 
            usuarioId VARCHAR(255), 
            text TEXT, 
            categoria VARCHAR(255), 
            isPinned BOOLEAN, 
            updatedAt BIGINT,
            INDEX(usuarioId)
        )`);

        // Tabla Conversaciones: Vinculada al usuarioId
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

        console.log("✅ Servidor Textify conectado a MySQL y listo.");
        conn.release();
    } catch (err) {
        console.error("❌ ERROR AL INICIAR DB:", err.message);
    }
}
initDb();

// Ruta de comprobación
app.get('/', (req, res) => res.send('🚀 Backend de Textify operando correctamente'));

// --- SISTEMA DE AUTENTICACIÓN DINÁMICO ---

app.post('/api/auth/register', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    const id = Date.now().toString(); // ID Único generado para el nuevo usuario
    try {
        await pool.query(
            'INSERT INTO usuarios (id, nombre, correo, contrasena, fechaRegistro, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
            [id, nombre, correo, contrasena, Date.now(), Date.now()]
        );
        console.log(`👤 Registro: ${correo} asignado al ID: ${id}`);
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
            console.log(`🔑 Login exitoso: ${user.nombre} (ID: ${user.id})`);
            res.json({ token: "session_token_active", userId: user.id, nombre: user.nombre });
        } else {
            res.status(401).json({ error: "Credenciales incorrectas" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- SINCRONIZACIÓN ESPEJO (SUBIR) ---
app.post('/api/sync/push', async (req, res) => {
    const { phrases, conversations, userId } = req.body;
    
    // Identificamos al usuario de forma obligatoria
    const finalUserId = userId || (phrases && phrases[0]?.usuarioId) || (conversations && conversations[0]?.usuarioId);

    if (!finalUserId || finalUserId === "default_user") {
        return res.status(400).json({ error: "ID de usuario no válido para sincronización" });
    }

    console.log(`🔄 PUSH: Reemplazando nube para usuario: ${finalUserId}`);
    
    try {
        const conn = await pool.getConnection();
        await conn.beginTransaction();

        try {
            // 1. Borramos todo lo anterior de ESTE usuario específico
            await conn.query('DELETE FROM phrases WHERE usuarioId = ?', [finalUserId]);
            await conn.query('DELETE FROM conversations WHERE usuarioId = ?', [finalUserId]);

            // 2. Insertamos lo nuevo que viene del celular
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
            console.log(`✅ PUSH completado para usuario ${finalUserId}`);
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

// --- SINCRONIZACIÓN ESPEJO (BAJAR) ---
app.get('/api/sync/pull', async (req, res) => {
    const { userId } = req.query;
    
    if (!userId || userId === "default_user") {
        return res.status(400).json({ error: "Se requiere un ID de usuario real" });
    }
    
    console.log(`📤 PULL: Descargando copia de seguridad para: ${userId}`);
    
    try {
        const [phrases] = await pool.query('SELECT * FROM phrases WHERE usuarioId = ?', [userId]);
        const [convs] = await pool.query('SELECT * FROM conversations WHERE usuarioId = ?', [userId]);
        
        console.log(`✅ PULL: Enviando ${phrases.length} frases y ${convs.length} chats a la App.`);
        res.json({ 
            phrases: phrases, 
            conversations: convs 
        });
    } catch (err) {
        console.error("❌ Error en PULL:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// Puerto asignado por Railway
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor Textify escuchando en puerto ${PORT}`);
});