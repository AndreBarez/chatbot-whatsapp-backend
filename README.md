# WhatsApp ChatBOT (Backend)

Este repositório contém o código backend para um sistema de Atendimento Híbrido (Chatbot e Atendente Humano) via WhatsApp, utilizando a API não-oficial **Baileys** e comunicação em tempo real via **Socket.IO**.

O projeto foi desenvolvido para aprendizado e servir para um futuro portfólio, demonstrando habilidades em integração de mensageria, API RESTful, persistência de dados (MongoDB) e comunicação bidirecional de baixa latência.

---

##  Visão Geral da Arquitetura

O sistema funciona como um servidor central que gerencia três componentes principais:

* **Conexão WhatsApp (Baileys):** Gerencia a sessão do bot, recebe mensagens e envia respostas.
* **Lógica do Bot/Atendimento:** Controla o fluxo de triagem, encaminhamento e a sessão persistente do chatbot.
* **Comunicação em Tempo Real (Socket.IO):** Canal para o Painel de Atendimento (Frontend), enviando notificações de novas mensagens e atualizações de status instantaneamente.



---

## Tecnologias Utilizadas

**Linguagem/Runtime**
* **Node.js:** Ambiente de execução JavaScript.

**Framework Web**
* **Express v5.x:** API para autenticação e rotas administrativas.

**Mensageria**
* **Baileys v7.x:** Conexão e gerenciamento da sessão do WhatsApp.

* **Socket.IO v4.x:** Protocolo para comunicação bidirecional com o painel.

**Banco de Dados**
* **MongoDB v6.x:** Persistência de dados de atendimento, histórico, usuários e sessões de bot.

**Segurança**
* **JWT, bcryptjs:** Autenticação segura de atendentes e *hashing* de senhas.

---

## Configuração e Instalação

### 1. Pré-requisitos

* **Node.js** (versão 18+ recomendada)
* **MongoDB** (Instância Atlas ou local)
* **Conta WhatsApp** para ser usada como bot.

### 2. Clonagem e Dependências

```bash
# Clone este repositório
git clone [https://github.com/AndreBarez/chatbot-whatsapp-backend.git](https://github.com/AndreBarez/chatbot-whatsapp-backend.git)
cd chatbot-whatsapp-backend

# Instale as dependências
npm install
