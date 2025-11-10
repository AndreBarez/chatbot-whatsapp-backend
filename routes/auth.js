const express = require('express');
const router = express.Router(); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken'); 
require('dotenv').config(); 

function createAuthRoutes(db) {

    // Cria admins
    router.post('/registrar', async (req, res) => {
        try {
            const { username, password, adminSecret } = req.body;
            if (adminSecret !== process.env.ADMIN_REGISTRATION_SECRET) return res.status(403).json({ message: 'Senha de administrador inválida.' });
            if (!username || !password) return res.status(400).json({ message: 'Nome de usuário e senha são obrigatórios.' });
            const usuarioExistente = await db.collection('usuarios').findOne({ username });
            if (usuarioExistente) return res.status(409).json({ message: 'Nome de usuário já em uso.' });
            
            const hashedPassword = await bcrypt.hash(password, await bcrypt.genSalt(10));
            
            
            await db.collection('usuarios').insertOne({ 
                username, 
                password: hashedPassword, 
                role: 'admin' 
            });
            
            res.status(201).json({ message: `Administrador '${username}' criado com sucesso!` });
        } catch (error) { res.status(500).json({ message: 'Erro interno do servidor.' }); }
    });

    // Rota de Login
    router.post('/login', async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password) return res.status(400).json({ message: 'Nome de usuário e senha são obrigatórios.' });
            
            const usuario = await db.collection('usuarios').findOne({ username });
            if (!usuario || !(await bcrypt.compare(password, usuario.password))) return res.status(401).json({ message: 'Credenciais inválidas.' });
            
            // Se não tiver um role vira atendente
            const userRole = usuario.role || 'atendente';

             
            const token = jwt.sign(
                { 
                    id: usuario._id, 
                    username: usuario.username, 
                    role: userRole 
                }, 
                process.env.JWT_SECRET, 
                { expiresIn: '12h' }
            ); 
            
            
            res.status(200).json({ 
                message: 'Login bem-sucedido!', 
                token,
                username: usuario.username, 
                role: userRole             
            });
        } catch (error) { res.status(500).json({ message: 'Erro interno do servidor.' }); }
    });

    return router;
}

module.exports = createAuthRoutes;