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
                <h2>✅ WhatsApp AI Bot सफलतापूर्वक कनेक्टेड है!</h2>
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

    // नया और सुधरा हुआ मैसेज हैंडलर
    sock.ev.on('messages.upsert', async (chatUpdate) => {
        if (chatUpdate.type !== 'notify') return;
        
        const m = chatUpdate.messages[0];
        if (!m.message || m.key.fromMe) return;

        const sender = m.key.remoteJid;
        
        // स्टेटस या ब्रॉडकास्ट मैसेज को इग्नोर करें
        if (sender.includes('status@broadcast')) return;

        const messageContent = m.message.ephemeralMessage?.message || m.message;
        const textMessage = messageContent.conversation || 
                            messageContent.extendedTextMessage?.text || 
                            messageContent.imageMessage?.caption;

        if (!textMessage) return;

        try {
            console.log(`💬 नया संदेश मिला (${sender}): ${textMessage}`);
            
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(textMessage);
            const responseText = result.response.text();

            await sock.sendMessage(sender, { text: responseText });
            console.log(`🤖 AI का जवाब सफलताપૂર્વक भेज दिया गया.`);
        } catch (error) {
            console.error("❌ AI Error:", error);
        }
    });
}

startBot();
