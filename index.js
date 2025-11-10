const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { connectDB } = require('./database.cjs');
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');


const createAuthRoutes = require('./routes/auth.js');
const createAdminRoutes = require('./routes/admin.js');

const app = express();
app.use(cors());
app.use(express.json());

const mediaDir = path.join(__dirname, 'public', 'media');
if (!fs.existsSync(mediaDir)){
    fs.mkdirSync(mediaDir, { recursive: true });
}
app.use('/media', express.static(mediaDir));

const server = http.createServer(app);


// Mudar para local ou render
const io = new Server(server, { cors: { origin: "http://localhost:5173" } });


const planosMessage = `Ótima escolha! Nossos planos são pensados para você. Confira:\n\n*Plano Básico \n*600mb:* \n*Valor:* R$99,90 por mês.`;
const mensagemDeEncerramento = " Obrigado por estar conosco! Atendimento finalizado.";
const mensagemDeEspera = "Entendido! Direcionei sua solicitação para a equipe responsável. Por favor, aguarde um momento que um de nossos especialistas já irá te responder por aqui. 👨‍💼";
const mensagemEncaminhamentoVendas = "Agradecemos seu interesse! Você está a um passo de algo incrível! 🚀 Um dos nossos especialistas entrará em contato com você ainda hoje para mostrar tudo o que preparamos especialmente para você. Fique de olho no seu celular! 📲✨";


let db;
let sock;

function emitirParaPainel(evento, dados) {
    io.sockets.sockets.forEach((socket) => {
        socket.emit(evento, dados);
    });
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    sock = makeWASocket({
        version: (await fetchLatestBaileysVersion()).version,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    async function encaminharParaVendasEEncerrar(atendimento) {
        const groupId = process.env.WHATSAPP_VENDAS_GROUP_ID;
        if (!groupId) { console.error("ERRO: WHATSAPP_VENDAS_GROUP_ID não definido."); return; }
        const clienteNome = atendimento.nome;
        const clienteNumero = atendimento.clienteId.split('@')[0];
        const mensagemGrupo = `🔔 Novo Lead! 🔔\n\n*Cliente:* ${clienteNome}\n*Contato:* ${clienteNumero}\n\nPor favor, entrar em contato.`;
        try {
            await sock.sendMessage(groupId, { text: mensagemGrupo });
            await sock.sendMessage(atendimento.clienteId, { text: mensagemEncaminhamentoVendas });
            const mensagemFinalBot = { remetente: 'bot', tipo: 'texto', conteudo: mensagemEncaminhamentoVendas, timestamp: new Date() }; 
            await db.collection('atendimentos').updateOne(
                { _id: atendimento._id },
                { $set: { status: 'Resolvido', setor: 'Vendas' }, $push: { historico: mensagemFinalBot }, $unset: { botSession: "" } }
            );
            const atendimentoResolvido = await db.collection('atendimentos').findOne({ _id: atendimento._id });
            emitirParaPainel('atendimento_resolvido', { atendimentoResolvido });
        } catch (error) {
             console.error("Erro ao encaminhar para vendas:", error);
        }
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
         const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.generate(qr, { small: true });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log('Conexão perdida, reconectando...');
                connectToWhatsApp();
            } else {
                console.log('Conexão fechada permanentemente. Você foi desconectado.');
            }
        } else if (connection === 'open') console.log('✅ Conexão com WhatsApp aberta!');
    });

    async function getProfilePictureUrl(jid) {
        try { return await sock.profilePictureUrl(jid, 'image'); } catch { return null; }
    }

    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== "notify") return;
        const msg = m.messages[0];
        const salesGroupId = process.env.WHATSAPP_VENDAS_GROUP_ID;
        if (salesGroupId && msg.key.remoteJid === salesGroupId) return;
        if (!msg.message || msg.key.fromMe) return;

        const senderId = msg.key.remoteJid;
        const nomeCliente = msg.pushName;
        let novaMensagemHistorico;

        try {
            //  Processa Mensagem 
            const messageContent = msg.message;
            const textContent = messageContent.conversation || messageContent.extendedTextMessage?.text;
            if (textContent) {
                novaMensagemHistorico = { remetente: 'cliente', tipo: 'texto', conteudo: textContent.trim(), timestamp: new Date() };
            } else if (messageContent.imageMessage || messageContent.audioMessage || messageContent.videoMessage || messageContent.documentMessage) {
                const stream = await downloadMediaMessage(msg, 'buffer', {});
                const buffer = Buffer.from(stream);
                let extension, tipo;
                if(messageContent.imageMessage) { extension = 'jpg'; tipo = 'imagem'; }
                else if(messageContent.audioMessage) { extension = 'ogg'; tipo = 'audio'; }
                else if(messageContent.videoMessage) { extension = 'mp4'; tipo = 'video'; }
                else if(messageContent.documentMessage) { extension = path.extname(messageContent.documentMessage.fileName).slice(1) || 'bin'; tipo = 'documento'; }
                else { return; } // Ignora outros tipos
                const filename = `${uuidv4()}.${extension}`;
                const filepath = path.join(mediaDir, filename);
                fs.writeFileSync(filepath, buffer);
                const publicUrl = `${process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`}/media/${filename}`;
                novaMensagemHistorico = { remetente: 'cliente', tipo: tipo, url: publicUrl, timestamp: new Date() };
                 if(tipo === 'documento') novaMensagemHistorico.nomeArquivo = messageContent.documentMessage.fileName;
            } else { console.log('Tipo de mensagem não suportado:', Object.keys(msg.message)[0]); return; }
            if (!novaMensagemHistorico || (!novaMensagemHistorico.conteudo && !novaMensagemHistorico.url)) return;
            

            // Cria e reativa Atendimento
            let atendimentoExistente = await db.collection('atendimentos').findOne({ clienteId: senderId });
            let atendimentoFoiReativado = false;

            if (!atendimentoExistente) {
                const fotoPerfilUrl = await getProfilePictureUrl(senderId);
                const novoAtendimento = {
                    clienteId: senderId, nome: nomeCliente, setor: 'Triagem',
                    status: 'Com Bot', timestamp: new Date(), historico: [novaMensagemHistorico], fotoPerfilUrl
                };
                const result = await db.collection('atendimentos').insertOne(novoAtendimento);
                atendimentoExistente = { ...novoAtendimento, _id: result.insertedId };
                emitirParaPainel('novo_atendimento', atendimentoExistente);
            } else {
                const originalStatus = atendimentoExistente.status;
                let updateOps = { $push: { historico: novaMensagemHistorico } };
                let newStatus = originalStatus;
                if (originalStatus === 'Resolvido' || originalStatus === 'Lead Frio') {
                    newStatus = 'Com Bot';
                    updateOps.$set = { status: newStatus, timestamp: new Date() };
                    updateOps.$unset = { botSession: "" };
                    atendimentoFoiReativado = true;
                }
                await db.collection('atendimentos').updateOne({ _id: atendimentoExistente._id }, updateOps);
                atendimentoExistente.historico.push(novaMensagemHistorico);
                if (updateOps.$set) {
                    atendimentoExistente.status = newStatus;
                    atendimentoExistente.timestamp = updateOps.$set.timestamp;
                    delete atendimentoExistente.botSession;
                }
                if (atendimentoFoiReativado) {
                    const atendimentoReativadoPeloCliente = await db.collection('atendimentos').findOne({ _id: atendimentoExistente._id });
                    emitirParaPainel('atendimento_reativado', { atendimentoReativado: atendimentoReativadoPeloCliente });
                } else {
                    emitirParaPainel('mensagem_atualizada', { atendimentoId: atendimentoExistente._id, novaMensagem: novaMensagemHistorico });
                }
            }
            //  Fim Lógica Reativação


            //  Sessão Persistente bot
            if (atendimentoExistente.status === 'Com Bot' && novaMensagemHistorico.tipo === 'texto') {
                const messageBody = novaMensagemHistorico.conteudo;
                let session = atendimentoExistente.botSession || { stage: 'initial' };
                let sessionUpdated = false;

                if (session.stage === 'initial') {
                    
                    await sock.sendMessage(senderId, { text: 'Olá! 👋 Sou seu assistente virtual. Para começar, por favor, digite o número da opção desejada:\n\n*1️⃣* Quero conhecer os planos (Sou novo por aqui)\n*2️⃣* Já sou cliente' });

                    session.stage = 'awaiting_main_choice';
                    sessionUpdated = true;
                    await db.collection('atendimentos').updateOne( { _id: atendimentoExistente._id }, { $set: { botSession: session } } );
                    return;
                }

                switch (session.stage) {
                    case 'awaiting_main_choice':
                        if (messageBody === '1') {
                            await sock.sendMessage(senderId, { text: 'Entendido! O que você gostaria de fazer?\n\n*1* - Receber nosso catálogo de planos e preços\n*2* - Falar com um especialista agora' });
                            session.stage = 'awaiting_new_customer_choice';
                            sessionUpdated = true;
                        } else if (messageBody === '2') {
                            await sock.sendMessage(senderId, { text: 'Olá, cliente! Para agilizar, escolha o assunto:\n\n*1* - Agendar consulta\n*2* - 2ª via de boleto e pagamentos\n*3* - Suporte técnico\n*4* - Outros assuntos (falar com atendente)' });
                            session.stage = 'awaiting_existing_customer_choice';
                            sessionUpdated = true;
                        } else { await sock.sendMessage(senderId, { text: `❌ Opção inválida.` }); }
                        break;
                    case 'awaiting_new_customer_choice':
                        if (messageBody === '1') {
                            await sock.sendMessage(senderId, { text: planosMessage }); 
                            await sock.sendMessage(senderId, { text: 'Gostaria de falar com um de nossos especialistas?\n\n*1* - Sim\n*2* - Não' });
                            session.stage = 'awaiting_sales_decision';
                            sessionUpdated = true;
                        } else if (messageBody === '2') {
                            await encaminharParaVendasEEncerrar(atendimentoExistente); 
                            session = null;
                        } else { await sock.sendMessage(senderId, { text: `❌ Opção inválida.` }); }
                        break;
                    case 'awaiting_sales_decision':
                        if (messageBody === '1') {
                            await encaminharParaVendasEEncerrar(atendimentoExistente); 
                            session = null;
                        } else if (messageBody === '2') {
                            const mensagemFinalBot = 'Entendido! Se precisar de algo, é só chamar. 😊';
                            await sock.sendMessage(senderId, { text: mensagemFinalBot });
                            const historicoFinal = { remetente: 'bot', tipo: 'texto', conteudo: mensagemFinalBot, timestamp: new Date() };
                            await db.collection('atendimentos').updateOne(
                                { _id: atendimentoExistente._id },
                                { $set: { status: 'Lead Frio' }, $push: { historico: historicoFinal }, $unset: { botSession: "" } }
                            );
                            const atendimentoResolvido = await db.collection('atendimentos').findOne({ _id: atendimentoExistente._id });
                            emitirParaPainel('atendimento_resolvido', { atendimentoResolvido });
                            session = null;
                        } else { await sock.sendMessage(senderId, { text: `❌ Opção inválida.` }); }
                        break;
                    case 'awaiting_existing_customer_choice':
                        const setores = { '1': 'Agendamento', '2': 'Financeiro', '3': 'Suporte Técnico', '4': 'Atendimento Geral' };
                        if (setores[messageBody]) {
                            const setorEscolhido = setores[messageBody];
                            await db.collection('atendimentos').updateOne(
                                { _id: atendimentoExistente._id },
                                { $set: { setor: setorEscolhido, status: 'Aguardando Atendimento' }, $unset: { botSession: "" } }
                            );
                            emitirParaPainel('status_atualizado', { atendimentoId: atendimentoExistente._id, novoStatus: 'Aguardando Atendimento', novoSetor: setorEscolhido });
                            await sock.sendMessage(senderId, { text: mensagemDeEspera }); 
                            session = null;
                        } else { await sock.sendMessage(senderId, { text: `❌ Opção inválida.` }); }
                        break;
                    default:
                         console.warn(`Estado de sessão desconhecido '${session.stage}' para ${senderId}. Resetando.`);
                         session = { stage: 'initial' };
                         sessionUpdated = true;
                         break;
                } // Fim do switch

                
                if (sessionUpdated && session) {
                    await db.collection('atendimentos').updateOne( { _id: atendimentoExistente._id }, { $set: { botSession: session } } );
                }

            } //Fim do if status  'Com Bot'

        } catch (error) {
            console.error('ERRO NO PROCESSAMENTO DA MENSAGEM:', error);
        }
    }); 

} 


async function start() {
    db = await connectDB();
    connectToWhatsApp();

    //   autenticação do socket.IO JWT
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error: No token provided'));
        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                 console.error("Socket Auth Error:", err.message);
                 return next(new Error(`Authentication error: ${err.message}`));
            }
            socket.user = user; // Anexa id username e role
            next();
        });
    });

    // socket.io
    io.on('connection', async (socket) => {

        console.log(`🔌 Painel conectado: ${socket.id}, Usuário: ${socket.user.username} (${socket.user.role})`);
        socket.on('disconnect', () => {
            console.log(`🔌 Cliente do painel desconectado: ${socket.id}`);
        });

        //  busca atendimentos ativos
        socket.on('buscar_atendimentos_iniciais', async () => {
             try {
                const atendimentosAtivos = await db.collection('atendimentos').find({ status: { $in: ['Com Bot', 'Aguardando Atendimento', 'Em Atendimento'] } }).sort({ timestamp: 1 }).toArray();
                socket.emit('lista_atendimentos', atendimentosAtivos);
            } catch (error) { console.error('Erro ao buscar atendimentos no DB:', error); }
        });

        //  enviar mensagem do painel
        socket.on('enviar_mensagem', async ({ atendimentoId, conteudo }) => {
            try {
                if (!sock) { throw new Error("Conexão com WhatsApp (sock) não está ativa."); }
                if(!ObjectId.isValid(atendimentoId)) return;
                const atendimento = await db.collection('atendimentos').findOne({ _id: new ObjectId(atendimentoId) });
                if (!atendimento) return;

                await sock.sendMessage(atendimento.clienteId, { text: conteudo });
                const novaMensagem = { remetente: 'atendente', tipo: 'texto', conteudo, timestamp: new Date() };

                // Define como 'Em Atendimento' e limpa qualquer sessão de bot
                const updateResult = await db.collection('atendimentos').updateOne(
                    { _id: new ObjectId(atendimentoId) },
                    {
                        $push: { historico: novaMensagem },
                        $set: { status: 'Em Atendimento' },
                        $unset: { botSession: "" } // Limpa sessão do bot ao enviar msg humana
                    }
                );

                if (updateResult.modifiedCount > 0 && atendimento.status !== 'Em Atendimento') {
                    // Emitir status_atualizado apenas se o status realmente mudou
                     emitirParaPainel('status_atualizado', { atendimentoId: new ObjectId(atendimentoId), novoStatus: 'Em Atendimento' });
                }
                // Sempre emitir mensagem atualizada
                emitirParaPainel('mensagem_atualizada', { atendimentoId: new ObjectId(atendimentoId), novaMensagem });
            } catch (error) { console.error('Erro ao enviar mensagem do painel:', error); }
        });

        //  reativa e envia mensagem usado em Leads Frios
        socket.on('reativar_e_enviar_mensagem', async ({ atendimentoId, conteudo }) => {
            try {
                if (!sock) { throw new Error("Conexão com WhatsApp (sock) não está ativa."); }
                if(!ObjectId.isValid(atendimentoId)) return;
                const objectId = new ObjectId(atendimentoId);
                const atendimento = await db.collection('atendimentos').findOne({ _id: objectId });
                if (!atendimento || atendimento.status !== 'Lead Frio') {
                    console.error('Tentativa de reativar atendimento que não é Lead Frio ou não existe.');
                    return;
                }
                await sock.sendMessage(atendimento.clienteId, { text: conteudo });
                const novaMensagem = { remetente: 'atendente', tipo: 'texto', conteudo, timestamp: new Date() };
                // define status, setor e limpa sessão do bot
                const result = await db.collection('atendimentos').updateOne(
                    { _id: objectId },
                    {
                        $set: { status: 'Em Atendimento', setor: 'Vendas' }, // Ajuste setor conforme necessário
                        $push: { historico: novaMensagem },
                        $unset: { botSession: "" }
                    }
                );
                if (result.modifiedCount > 0) {
                    const atendimentoReativado = await db.collection('atendimentos').findOne({ _id: objectId });
                    emitirParaPainel('atendimento_reativado', { atendimentoReativado });
                } else {
                     console.warn("Nenhuma modificação ao tentar reativar e enviar mensagem para:", atendimentoId);
                }
            } catch (error) { console.error('Erro ao reativar atendimento e enviar msg:', error); }
        });

        // marca como Em Atendimento qundo clica no chat Aguardando
        socket.on('marcar_como_em_atendimento', async ({ atendimentoId }) => {
            try {
                if(!ObjectId.isValid(atendimentoId)) return;
                // Define status e limpa sessão do bot
                const result = await db.collection('atendimentos').updateOne(
                   { _id: new ObjectId(atendimentoId), status: { $ne: 'Em Atendimento'} },
                   { $set: { status: 'Em Atendimento' }, $unset: { botSession: "" } }
                );
                if (result.modifiedCount > 0) {
                   emitirParaPainel('status_atualizado', { atendimentoId: new ObjectId(atendimentoId), novoStatus: 'Em Atendimento' });
                }
            } catch (error) { console.error('Erro ao marcar como em atendimento:', error); }
        });

        //  marca como Resolvido
        socket.on('marcar_como_resolvido', async ({ atendimentoId }) => {
            try {
                if (!sock) { throw new Error("Conexão com WhatsApp (sock) não está ativa."); }
                if(!ObjectId.isValid(atendimentoId)) return;
                const objectId = new ObjectId(atendimentoId);
                const atendimento = await db.collection('atendimentos').findOne({ _id: objectId });
                if (!atendimento || atendimento.status === 'Resolvido') return;

                

                await sock.sendMessage(atendimento.clienteId, { text: mensagemDeEncerramento }); // Usa constante corrigida
                const mensagemFinal = { remetente: 'bot', tipo: 'texto', conteudo: mensagemDeEncerramento, timestamp: new Date() }; // Usa constante corrigida
                // Define status e limpa sessão do bot
                await db.collection('atendimentos').updateOne(
                    { _id: objectId },
                    {
                        $set: { status: 'Resolvido' },
                        $push: { historico: mensagemFinal },
                        $unset: { botSession: "" }
                    }
                );
                const atendimentoResolvido = await db.collection('atendimentos').findOne({ _id: objectId });
                emitirParaPainel('atendimento_resolvido', { atendimentoResolvido });
            } catch (error) { console.error('ERRO AO MARCAR COMO RESOLVIDO:', error); }
        });

        // pega atendimento Com Bot/Aguardando ou reativar Resolvido/Lead Frio
        socket.on('pegar_atendimento', async ({ atendimentoId }) => {
            try {
                if(!ObjectId.isValid(atendimentoId)) return;
                const objectId = new ObjectId(atendimentoId);
                const atendimento = await db.collection('atendimentos').findOne({ _id: objectId });
                if (!atendimento || atendimento.status === 'Em Atendimento') return;

                const originalStatus = atendimento.status;

                // Define status para Em Atendimentoe limpa sessão do bot
                const result = await db.collection('atendimentos').updateOne(
                    { _id: objectId },
                    { $set: { status: 'Em Atendimento' }, $unset: { botSession: "" } }
                );

                if (result.modifiedCount > 0) {
                    if (originalStatus === 'Com Bot' || originalStatus === 'Aguardando Atendimento') {
                        emitirParaPainel('status_atualizado', { atendimentoId: new ObjectId(atendimentoId), novoStatus: 'Em Atendimento' });
                    } else if (originalStatus === 'Resolvido' || originalStatus === 'Lead Frio') {
                        const atendimentoReativado = await db.collection('atendimentos').findOne({ _id: objectId });
                        emitirParaPainel('atendimento_reativado', { atendimentoReativado });
                        
                    }
                }
            } catch (error) { console.error('Erro ao pegar/reativar atendimento:', error); }
        });

        // Evento para buscar atendimentos resolvidos/frios
        socket.on('buscar_resolvidos', async () => {
             try {
                const encerrados = await db.collection('atendimentos').find({
                    status: { $in: ['Resolvido', 'Lead Frio'] }
                }).sort({ timestamp: -1 }).limit(100).toArray();
                socket.emit('lista_resolvidos', encerrados);
            } catch (error) { console.error('Erro ao buscar encerrados:', error); }
        });

    }); 


    // REGISTRO DAS ROTAS DA API 
    app.use('/api', createAuthRoutes(db));
    app.use('/api/admin', createAdminRoutes(db));

    // Health Check
    app.get('/health', (req, res) => {
      console.log('Ping recebido! O serviço está ativo.');
      res.status(200).json({ status: 'ok', message: 'Service is healthy.', timestamp: new Date().toISOString() });
    });

    // Inicia o Servidor
    const PORT = process.env.PORT || 3001;
    server.listen(PORT, () => console.log(`🚀 Servidor web rodando na porta ${PORT}`));
}

// Inicia tudo
start();