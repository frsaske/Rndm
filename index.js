/**
 * ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━ - A WhatsApp Bot
 * Copyright (c) 2026 SasukeX
 * 
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the MIT License.
 * 
 * Credits:
 * - Baileys Library by @adiwajshing
 * - Pair Code implementation inspired by TechGod143 & DGXEON
 */
require('./settings')
const { Boom } = require('@hapi/boom')
const fs = require('fs')
const chalk = require('chalk')
const FileType = require('file-type')
const path = require('path')
const axios = require('axios')
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, await, sleep, reSize } = require('./lib/myfunc')
const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    generateForwardMessageContent,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    generateMessageID,
    downloadContentFromMessage,
    jidDecode,
    proto,
    jidNormalizedUser,
    makeCacheableSignalKeyStore,
    delay
} = require("@whiskeysockets/baileys")
const NodeCache = require("node-cache")
const pino = require("pino")
const readline = require("readline")
const { parsePhoneNumber } = require("libphonenumber-js")
const { PHONENUMBER_MCC } = require('@whiskeysockets/baileys/lib/Utils/generics')
const { rmSync, existsSync } = require('fs')
const { join } = require('path')

// Import lightweight store
const store = require('./lib/lightweight_store')

// Initialize store
store.readFromFile()
const settings = require('./settings')
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Memory optimization - Force garbage collection if available
setInterval(() => {
    if (global.gc) {
        global.gc()
        console.log('🧹 Garbage collection completed')
    }
}, 60_000) // every 1 minute

// Memory monitoring - Restart if RAM gets too high
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log('⚠️ RAM too high (>400MB), restarting bot...')
        process.exit(1) // Panel will auto-restart
    }
}, 30_000) // check every 30 seconds

let phoneNumber = "911234567890"
let owner = JSON.parse(fs.readFileSync('./data/owner.json'))

global.botname = "━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━"
global.themeemoji = "⚡"
const pairingCode = !!phoneNumber || process.argv.includes("--pairing-code")
const useMobile = process.argv.includes("--mobile")

// Only create readline interface if we're in an interactive environment
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => {
    if (rl) {
        return new Promise((resolve) => rl.question(text, resolve))
    } else {
        return Promise.resolve(settings.ownerNumber || phoneNumber)
    }
}

// Multi-Session Support Array (Supports up to 5 Sessions: ./session, ./session2, ./session3, ./session4, ./session5)
const MULTI_SESSIONS = ['./session', './session2', './session3', './session4', './session5'];

async function startSasukeSession(sessionPath, index) {
    try {
        if (!existsSync(sessionPath)) {
            fs.mkdirSync(sessionPath, { recursive: true });
        }

        let { version, isLatest } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
        const msgRetryCounterCache = new NodeCache()

        const SasukeBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: index === 0 ? !pairingCode : false,
            browser: [`SasukeX-${index + 1}`, "Chrome", "20.0.04"],
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })),
            },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => {
                let jid = jidNormalizedUser(key.remoteJid)
                let msg = await store.loadMessage(jid, key.id)
                return msg?.message || ""
            },
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000,
        })

        // Save credentials when they update
        SasukeBotInc.ev.on('creds.update', saveCreds)

        store.bind(SasukeBotInc.ev)

        // Message handling
        SasukeBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = (Object.keys(mek.message)[0] === 'ephemeralMessage') ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(SasukeBotInc, chatUpdate);
                    return;
                }
                if (!SasukeBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    const isGroup = mek.key?.remoteJid?.endsWith('@g.us')
                    if (!isGroup) return // Block DMs in private mode, but allow group messages
                }
                if (mek.key.id.startsWith('BAE5') && mek.key.id.length === 16) return

                // Clear message retry cache to prevent memory bloat
                if (SasukeBotInc?.msgRetryCounterCache) {
                    SasukeBotInc.msgRetryCounterCache.clear()
                }

                try {
                    await handleMessages(SasukeBotInc, chatUpdate, true)
                } catch (err) {
                    console.error(`Error in handleMessages [Session ${index + 1}]:`, err)
                    if (mek.key && mek.key.remoteJid) {
                        await SasukeBotInc.sendMessage(mek.key.remoteJid, {
                            text: '❌ An error occurred while processing your message.'
                        }).catch(console.error);
                    }
                }
            } catch (err) {
                console.error(`Error in messages.upsert [Session ${index + 1}]:`, err)
            }
        })

        // Add these event handlers for better functionality
        SasukeBotInc.decodeJid = (jid) => {
            if (!jid) return jid
            if (/:\d+@/gi.test(jid)) {
                let decode = jidDecode(jid) || {}
                return decode.user && decode.server && decode.user + '@' + decode.server || jid
            } else return jid
        }

        SasukeBotInc.ev.on('contacts.update', update => {
            for (let contact of update) {
                let id = SasukeBotInc.decodeJid(contact.id)
                if (store && store.contacts) store.contacts[id] = { id, name: contact.notify }
            }
        })

        SasukeBotInc.getName = (jid, withoutContact = false) => {
            id = SasukeBotInc.decodeJid(jid)
            withoutContact = SasukeBotInc.withoutContact || withoutContact
            let v
            if (id.endsWith("@g.us")) return new Promise(async (resolve) => {
                v = store.contacts[id] || {}
                if (!(v.name || v.subject)) v = SasukeBotInc.groupMetadata(id) || {}
                resolve(v.name || v.subject || PhoneNumber('+' + id.replace('@s.whatsapp.net', '')).getNumber('international'))
            })
            else v = id === '0@s.whatsapp.net' ? {
                id,
                name: 'WhatsApp'
            } : id === SasukeBotInc.decodeJid(SasukeBotInc.user.id) ?
                SasukeBotInc.user :
                (store.contacts[id] || {})
            return (withoutContact ? '' : v.name) || v.subject || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international')
        }

        SasukeBotInc.public = true

        SasukeBotInc.serializeM = (m) => smsg(SasukeBotInc, m, store)

        // Handle pairing code (only on primary session if needed)
        if (pairingCode && !SasukeBotInc.authState.creds.registered && index === 0) {
            if (useMobile) throw new Error('Cannot use pairing code with mobile api')

            let phoneNumber
            if (!!global.phoneNumber) {
                phoneNumber = global.phoneNumber
            } else {
                phoneNumber = await question(chalk.bgBlack(chalk.greenBright(`Please type your WhatsApp number 😍\nFormat: 6281376552730 (without + or spaces) : `)))
            }

            phoneNumber = phoneNumber.replace(/[^0-9]/g, '')

            const pn = require('awesome-phonenumber');
            if (!pn('+' + phoneNumber).isValid()) {
                console.log(chalk.red('Invalid phone number. Please enter your full international number without + or spaces.'));
                process.exit(1);
            }

            setTimeout(async () => {
                try {
                    let code = await SasukeBotInc.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.black(chalk.bgGreen(`Your Pairing Code : `)), chalk.black(chalk.white(code)))
                } catch (error) {
                    console.error('Error requesting pairing code:', error)
                }
            }, 3000)
        }

        // Connection handling
        SasukeBotInc.ev.on('connection.update', async (s) => {
            const { connection, lastDisconnect, qr } = s
            
            if (qr && index === 0) {
                console.log(chalk.yellow(`📱 [Session ${index + 1}] QR Code generated. Please scan with WhatsApp.`))
            }
            
            if (connection === 'connecting') {
                console.log(chalk.yellow(`🔄 [Session ${index + 1}] Connecting to WhatsApp...`))
            }
            
            if (connection == "open") {
                console.log(chalk.magenta(` `))
                console.log(chalk.yellow(`⚡ [Session ${index + 1}] Connected to => ` + JSON.stringify(SasukeBotInc.user, null, 2)))

                try {
                    const botNumber = SasukeBotInc.user.id.split(':')[0] + '@s.whatsapp.net';
                    await SasukeBotInc.sendMessage(botNumber, {
                        text: `🤖 SasukeX Session ${index + 1} Connected Successfully!\n\n⏰ Time: ${new Date().toLocaleString()}\n✅ Status: Online and Ready!`
                    });
                } catch (error) {
                    console.error(`Error sending connection message [Session ${index + 1}]:`, error.message)
                }

                await delay(1999)
                console.log(chalk.yellow(`\n\n                  ${chalk.bold.blue(`[ ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━ Session ${index + 1} ]`)}\n\n`))
                console.log(chalk.cyan(`< ================================================== >`))
                console.log(chalk.magenta(`\n${global.themeemoji} BOT: ━━〔 ꜱᴀꜱᴜᴋᴇX 〕━━`))
                console.log(chalk.magenta(`${global.themeemoji} SESSION PATH: ${sessionPath}`))
                console.log(chalk.magenta(`${global.themeemoji} WA NUMBER: ${owner}`))
                console.log(chalk.green(`${global.themeemoji} 🤖 Bot Connected Successfully! ✅`))
                console.log(chalk.blue(`Bot Version: ${settings.version}`))
            }
            
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                const statusCode = lastDisconnect?.error?.output?.statusCode
                
                console.log(chalk.red(`[Session ${index + 1}] Connection closed due to ${lastDisconnect?.error}, reconnecting ${shouldReconnect}`))
                
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    try {
                        rmSync(sessionPath, { recursive: true, force: true })
                        console.log(chalk.yellow(`[Session ${index + 1}] Session folder deleted. Please re-authenticate.`))
                    } catch (error) {
                        console.error('Error deleting session:', error)
                    }
                }
                
                if (shouldReconnect) {
                    console.log(chalk.yellow(`[Session ${index + 1}] Reconnecting...`))
                    await delay(5000)
                    startSasukeSession(sessionPath, index)
                }
            }
        })

        // Track recently-notified callers to avoid spamming messages
        const antiCallNotified = new Set();

        // Anticall handler: block callers when enabled
        SasukeBotInc.ev.on('call', async (calls) => {
            try {
                const { readState: readAnticallState } = require('./commands/anticall');
                const state = readAnticallState();
                if (!state.enabled) return;
                for (const call of calls) {
                    const callerJid = call.from || call.peerJid || call.chatId;
                    if (!callerJid) continue;
                    try {
                        if (typeof SasukeBotInc.rejectCall === 'function' && call.id) {
                            await SasukeBotInc.rejectCall(call.id, callerJid);
                        } else if (typeof SasukeBotInc.sendCallOfferAck === 'function' && call.id) {
                            await SasukeBotInc.sendCallOfferAck(call.id, callerJid, 'reject');
                        }
                    } catch {}

                    if (!antiCallNotified.has(callerJid)) {
                        antiCallNotified.add(callerJid);
                        setTimeout(() => antiCallNotified.delete(callerJid), 60000);
                        await SasukeBotInc.sendMessage(callerJid, { text: '📵 Anticall is enabled. Your call was rejected and you will be blocked.' });
                    }
                    setTimeout(async () => {
                        try { await SasukeBotInc.updateBlockStatus(callerJid, 'block'); } catch {}
                    }, 800);
                }
            } catch (e) {}
        });

        SasukeBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(SasukeBotInc, update);
        });

        SasukeBotInc.ev.on('messages.upsert', async (m) => {
            if (m.messages[0].key && m.messages[0].key.remoteJid === 'status@broadcast') {
                await handleStatus(SasukeBotInc, m);
            }
        });

        SasukeBotInc.ev.on('status.update', async (status) => {
            await handleStatus(SasukeBotInc, status);
        });

        SasukeBotInc.ev.on('messages.reaction', async (status) => {
            await handleStatus(SasukeBotInc, status);
        });

        return SasukeBotInc
    } catch (error) {
        console.error(`Error in startSasukeSession [Session ${index + 1}]:`, error)
        await delay(5000)
        startSasukeSession(sessionPath, index)
    }
}

// Initialize all multi-sessions (up to 5)
async function startAllSessions() {
    for (let i = 0; i < MULTI_SESSIONS.length; i++) {
        const sessionPath = MULTI_SESSIONS[i];
        // Start session 1 always, and start session 2 to 5 if their folder exists
        if (i === 0 || existsSync(sessionPath)) {
            console.log(chalk.cyan(`🚀 Starting SasukeX Multi-Session [${i + 1}] at: ${sessionPath}`));
            await startSasukeSession(sessionPath, i);
            await delay(3000);
        }
    }
}

startAllSessions().catch(error => {
    console.error('Fatal multi-session error:', error)
    process.exit(1)
})

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err)
})

process.on('unhandledRejection', (err) => {
    console.error('Unhandled Rejection:', err)
})

let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    console.log(chalk.redBright(`Update ${__filename}`))
    delete require.cache[file]
    require(file)
})