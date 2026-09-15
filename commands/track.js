/**
 * ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━ - User Presence Tracker Feature
 * Tracks online/offline stats, last seen, and activity logs.
 */

const fs = require('fs');
const path = require('path');

const TRACK_DB_PATH = path.join(__dirname, '../data/tracker.json');

// Load tracker database
function loadTracker() {
    try {
        if (fs.existsSync(TRACK_DB_PATH)) {
            return JSON.parse(fs.readFileSync(TRACK_DB_PATH, 'utf8'));
        }
    } catch (e) {}
    return {};
}

// Save tracker database
function saveTracker(data) {
    try {
        if (!fs.existsSync(path.dirname(TRACK_DB_PATH))) {
            fs.mkdirSync(path.dirname(TRACK_DB_PATH), { recursive: true });
        }
        fs.writeFileSync(TRACK_DB_PATH, JSON.stringify(data, null, 2));
    } catch (e) {}
}

// Global active trackers map in memory
const activeTrackers = new Map(); // targetJid -> { tracking: true }

/**
 * Setup presence listener for tracking user activity
 */
function initPresenceTracker(sock) {
    sock.ev.on('presence.update', async ({ id, presences }) => {
        try {
            for (const [participant, data] of Object.entries(presences)) {
                const targetJid = participant || id;
                const cleanJid = targetJid.split('@')[0];
                
                // Check if this user is being tracked
                const db = loadTracker();
                if (db[cleanJid]) {
                    const now = Date.now();
                    const state = data.lastKnownPresence; // 'available' (online) or 'unavailable' (offline)
                    
                    if (!db[cleanJid].history) db[cleanJid].history = [];
                    
                    const lastStatus = db[cleanJid].currentStatus;
                    
                    if (state !== lastStatus) {
                        db[cleanJid].currentStatus = state;
                        if (state === 'available') {
                            db[cleanJid].onlineCount = (db[cleanJid].onlineCount || 0) + 1;
                            db[cleanJid].lastOnline = now;
                            db[cleanJid].history.unshift({ event: 'ONLINE 🟢', time: new Date().toLocaleString() });
                        } else if (state === 'unavailable') {
                            db[cleanJid].offlineCount = (db[cleanJid].offlineCount || 0) + 1;
                            db[cleanJid].lastOffline = now;
                            db[cleanJid].history.unshift({ event: 'OFFLINE 🔴', time: new Date().toLocaleString() });
                        }
                        
                        // Keep only last 20 history logs to save space
                        if (db[cleanJid].history.length > 20) {
                            db[cleanJid].history.pop();
                        }
                        
                        saveTracker(db);
                    }
                }
            }
        } catch (err) {
            console.error('Tracker presence update error:', err);
        }
    });
}

/**
 * Command Handler for .track
 */
async function trackCommand(sock, chatId, message, args) {
    try {
        const text = args.join(' ').trim();
        let targetNum = '';

        // Extract number or mentioned user
        const mentioned = message.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
        if (mentioned.length > 0) {
            targetNum = mentioned[0].split('@')[0];
        } else if (text) {
            targetNum = text.replace(/[^0-9]/g, '');
        }

        if (!targetNum || targetNum.length < 5) {
            return await sock.sendMessage(chatId, {
                text: `┏━━〔 ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━ 〕━━┓\n` +
                      `┃ ⚠️ *Invalid Usage!*\n` +
                      `┃ Please provide a valid phone number or mention someone.\n` +
                      `┃ \n` +
                      `┃ *Example:*\n` +
                      `┃ .track 917052500819\n` +
                      `┃ .track @tag\n` +
                      `┗━━━━━━━━━━━━━━━━━━━┛`,
                contextInfo: {
                    forwardingScore: 1,
                    isForwarded: true,
                    forwardedNewsletterMessageInfo: {
                        newsletterJid: '120363161513685998@newsletter',
                        newsletterName: '━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━',
                        serverMessageId: -1
                    }
                }
            }, { quoted: message });
        }

        const db = loadTracker();
        
        // If user is not yet tracked, initialize tracking
        if (!db[targetNum]) {
            db[targetNum] = {
                target: targetNum,
                onlineCount: 0,
                offlineCount: 0,
                lastOnline: null,
                lastOffline: null,
                currentStatus: 'unknown',
                history: []
            };
            saveTracker(db);
        }

        // Subscribe to target presence updates
        const targetJid = `${targetNum}@s.whatsapp.net`;
        try {
            await sock.presenceSubscribe(targetJid);
        } catch (e) {}

        const stats = db[targetNum];
        const lastOn = stats.lastOnline ? new Date(stats.lastOnline).toLocaleString() : 'No data yet';
        const lastOff = stats.lastOffline ? new Date(stats.lastOffline).toLocaleString() : 'No data yet';
        
        const historyLogs = stats.history && stats.history.length > 0 
            ? stats.history.slice(0, 5).map(h => `• ${h.event} - ${h.time}`).join('\n') 
            : '• No activity logs recorded yet.';

        const reportText = `┏━━〔 🎯 ꜱᴀꜱᴜᴋᴇX TRACKER 〕━━┓\n` +
                           `┃ 👤 *Target:* wa.me/${targetNum}\n` +
                           `┃ 🟢 *Online Count:* ${stats.onlineCount || 0} times\n` +
                           `┃ 🔴 *Offline Count:* ${stats.offlineCount || 0} times\n` +
                           `┃ ⏱️ *Last Online:* ${lastOn}\n` +
                           `┃ ⏳ *Last Offline:* ${lastOff}\n` +
                           `┣━━━━━━━━━━━━━━━━━━━┫\n` +
                           `┃ 📜 *Recent Activity Logs:*\n` +
                           `${historyLogs}\n` +
                           `┗━━━━━━━━━━━━━━━━━━━┛\n` +
                           `> *Powered by ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━*`;

        await sock.sendMessage(chatId, {
            text: reportText,
            contextInfo: {
                forwardingScore: 1,
                isForwarded: true,
                forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363161513685998@newsletter',
                    newsletterName: '━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━',
                    serverMessageId: -1
                }
            }
        }, { quoted: message });

    } catch (error) {
        console.error('Error in track command:', error);
        await sock.sendMessage(chatId, { text: '❌ Failed to fetch tracking details.' }, { quoted: message });
    }
}

module.exports = { trackCommand, initPresenceTracker };