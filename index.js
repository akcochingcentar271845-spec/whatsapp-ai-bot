const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const express = require('express');

// Render के पोर्ट की जरूरत पूरी करने के لیے छोटा सर्वर
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('WhatsApp AI Bot is running!'));
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("👉 QR CODE:", qr);
            console.log("👉 कृपया Render के Logs में जाकर इस QR कोड को अपने WhatsApp से स्कैन करें!");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            console.log('✅ WhatsApp AI Bot सफलतापूर्वक कनेक्ट हो गया है!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        const textMessage = m.message.conversation || m.message.extendedTextMessage?.text;

        if (!textMessage) return;

        try {
            console.log(`💬 संदेश मिला: ${textMessage}`);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(textMessage);
            const responseText = result.response.text();

            await sock.sendMessage(sender, { text: responseText });
            console.log(`🤖 जवाब भेजा गया.`);
        } catch (error) {
            console.error("AI Error:", error);
        }
    });
}

startBot();
