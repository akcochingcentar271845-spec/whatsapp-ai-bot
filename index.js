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
                <p>बॉट पहले से ही चालू अवस्था में है।</p>
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

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        
        // यह लाइन अब किसी भी प्रकार के मैसेज (सामान्य या Ephemeral) से टेक्स्ट को आसानी से निकाल लेगी
        const messageContent = m.message.ephemeralMessage?.message || m.message;
        const textMessage = messageContent.conversation || messageContent.extendedTextMessage?.text;

        if (!textMessage) return;

        try {
            console.log(`💬 संदेश मिला: ${textMessage}`);
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(textMessage);
            const responseText = result.response.text();

            await sock.sendMessage(sender, { text: responseText });
            console.log(`🤖 जवाब भेज दिया गया.`);
        } catch (error) {
            console.error("AI Error:", error);
        }
    });
}

startBot();
