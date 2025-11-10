const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ObjectId } = require('mongodb'); 
require('dotenv').config();

// autenticação de admin
const checkAdminAuth = (req, res, next) => {
    try {
        const token = req.headers.authorization.split(" ")[1];
        if (!token) {
            return res.status(401).json({ message: 'Nenhum token fornecido, autorização negada.' });
        }
        const decodedToken = jwt.verify(token, process.env.JWT_SECRET);
        if (decodedToken.role !== 'admin') {
            return res.status(403).json({ message: 'Acesso negado. Requer privilégios de administrador.' });
        }
        req.userData = decodedToken;
        next();
    } catch (error) {
        console.error("Auth Middleware Error:", error.message);
        return res.status(401).json({ message: `Token inválido ou expirado: ${error.message}` });
    }
};

// Função  cria as rotas de admin
function createAdminRoutes(db) {

    // Rota listar todos os atendentes
    router.get('/atendentes', checkAdminAuth, async (req, res) => {
        try {
            
            const atendentes = await db.collection('usuarios')
                                     .find({ role: { $in: ['atendente', null] } })
                                     .project({ password: 0 }) 
                                     .toArray();
            res.status(200).json(atendentes);
        } catch (error) {
            console.error("Erro ao buscar atendentes:", error);
            res.status(500).json({ message: 'Erro interno ao buscar atendentes.' });
        }
    });

    // criar um novo atendente
   
    router.post('/atendentes', checkAdminAuth, async (req, res) => {
        try {
            const { username, password } = req.body;
            if (!username || !password || typeof username !== 'string' || typeof password !== 'string' || username.trim() === '' || password.trim() === '') {
                return res.status(400).json({ message: 'Nome de usuário e senha são obrigatórios e não podem estar vazios.' });
            }
            const usuarioExistente = await db.collection('usuarios').findOne({ username });
            if (usuarioExistente) {
                return res.status(409).json({ message: 'Este nome de usuário já está em uso.' });
            }
            const hashedPassword = await bcrypt.hash(password, 10);
            const novoAtendente = {
                username,
                password: hashedPassword,
                role: 'atendente'
            };
            await db.collection('usuarios').insertOne(novoAtendente);
            res.status(201).json({ message: `Atendente '${username}' criado com sucesso.` });
        } catch (error) {
            console.error("Erro ao criar atendente:", error);
            res.status(500).json({ message: 'Erro interno ao criar atendente.' });
        }
    });

    // excluir atendente
    
    router.delete('/atendentes/:id', checkAdminAuth, async (req, res) => {
        try {
            const userId = req.params.id;
            if (!ObjectId.isValid(userId)) {
                return res.status(400).json({ message: 'ID de usuário inválido.' });
            }
            const result = await db.collection('usuarios').deleteOne({
                _id: new ObjectId(userId),
                
                role: { $in: ['atendente', null] } 
            });
            if (result.deletedCount === 0) {
                 // nao deixa deletar admin mesmo se a role for null
                 const maybeAdmin = await db.collection('usuarios').findOne({ _id: new ObjectId(userId) });
                 if(maybeAdmin && maybeAdmin.role === 'admin') {
                      return res.status(403).json({ message: 'Não é possível excluir um administrador.' });
                 }
                
                return res.status(404).json({ message: 'Atendente não encontrado.' });
            }
            res.status(200).json({ message: 'Atendente excluído com sucesso.' });
        } catch (error) {
            console.error("Erro ao excluir atendente:", error);
            res.status(500).json({ message: 'Erro interno ao excluir atendente.' });
        }
    });

    
    return router;
}


module.exports = createAdminRoutes;