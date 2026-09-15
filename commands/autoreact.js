/**
 * ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━ - Autoreact Feature
 */
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../data/autoreact_state.json');

function readState() {
    try {
        if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {}
    return { enabled: false };
}

function saveState(state) {
    if (!fs.existsSync(path.dirname(STATE_FILE))) fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function autoreactCommand(sock, chatId, message, args) {
    const state = readState();
    const cmd = args[0]?.toLowerCase();
    
    if (cmd === 'on') {
        state.enabled = true;
        saveState(state);
        await sock.sendMessage(chatId, { text: '✅ Autoreact enabled!' }, { quoted: message });
    } else if (cmd === 'off') {
        state.enabled = false;
        saveState(state);
        await sock.sendMessage(chatId, { text: '❌ Autoreact disabled!' }, { quoted: message });
    } else {
        await sock.sendMessage(chatId, { text: `Autoreact is currently: ${state.enabled ? 'ON' : 'OFF'}\nUsage: .autoreact on/off` }, { quoted: message });
    }
}

async function handleAutoreact(sock, m) {
    const state = readState();
    if (!state.enabled || m.fromMe || !m.message) return;
    
    try {
        await sock.sendMessage(m.chat, {
            react: {
                text: '⚡',
                key: m.key
            }
        });
    } catch (e) {}
}

module.exports = { autoreactCommand, handleAutoreact };
