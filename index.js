const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pino = require('pino');
const express = require('express');
const qrcode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3000;

let latestQR = '';

app.get('/', async (req, res) => {
    if (!latestQR) {
        return res.send(`
            <div style="text-align: center; margin-top: 50px; font-family: sans-serif;">
                <h2>✅ WhatsApp AI Bot कनेक्टेड है!</h2>
                <p>बॉट ऑनलाइन है और काम कर रहा है।</p>
            </div>
        `);
    }
    try {
        const qrImage = await qrcode.toDataURL(latestQR);
        res.send(`
            <div style="text-align: center; margin-top: 40px; font-family: sans-serif;">
                <h2>🤖 WhatsApp AI Bot QR Code</h2>
                <img src="${qrImage}" alt="QR Code" style="width: 320px; height: 320px; border: 3px solid #007bff; padding: 10px; border-radius: 12px; background: white;" />
            </div>
        `);
    } catch (err) {
        res.status(500).send('Error generating QR code');
    }
});

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
            latestQR = qr;
            console.log("👉 नया QR कोड मिल गया है!");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) { startBot(); }
        } else if (connection === 'open') {
            latestQR = '';
            console.log('✅ WhatsApp AI Bot सफलतापूर्वक कनेक्ट हो गया है!');
        }
    });

    sock.ev.on('messages.upsert', async (chatUpdate) => {
        try {
            const m = chatUpdate.messages[0];
            if (!m.message || m.key.fromMe) return;

            const sender = m.key.remoteJid;
            if (sender.includes('status@broadcast')) return;

            const msgBody = m.message.conversation || 
                            m.message.extendedTextMessage?.text || 
                            m.message.ephemeralMessage?.message?.conversation || 
                            m.message.ephemeralMessage?.message?.extendedTextMessage?.text;

            if (!msgBody) return;

            console.log(`💬 संदेश मिला (${sender}): ${msgBody}`);

            // 'gemini-pro' मॉडल का उपयोग किया गया है ताकि 404 एरर न आए
            const model = genAI.getGenerativeModel({ model: "gemini-pro" });
            const result = await model.generateContent(msgBody);
            const responseText = result.response.text();

            await sock.sendMessage(sender, { text: responseText });
            console.log(`🤖 AI का जवाब सफलतापूर्वक भेज दिया गया.`);
        } catch (error) {
            console.error("❌ Error in message handler:", error);
        }
    });
}

startBot();
