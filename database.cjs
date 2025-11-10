

// ferramenta para o arquivo .env
require('dotenv').config(); 
const { MongoClient, ServerApiVersion } = require('mongodb');


const uri = process.env.DATABASE_URL;


if (!uri) {
  console.error("ERRO: A variável DATABASE_URL não foi encontrada no arquivo .env");
  process.exit(1); 
}

// Cria um novo cliente do MongoDB
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

let db;

async function connectDB() {
  if (db) return db; // Se já estiver conectado, retorna a conexão existente
  try {
    // Conecta o cliente ao servidor
    await client.connect();
    // Seleciona o banco de dados
    db = client.db("bot_whatsapp_db"); 
    console.log("Conectado com sucesso ao MongoDB!");
    return db;
  } catch (error) {
    console.error("Falha ao conectar com o MongoDB", error);
    process.exit(1);
  }
}


module.exports = { connectDB };