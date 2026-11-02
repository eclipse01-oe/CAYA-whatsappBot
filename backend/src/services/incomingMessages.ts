import type { WASocket } from '@whiskeysockets/baileys';

import { emit } from '../config/eventEmitter.js';

import * as utils from '../utils/selfChatUtils.js';


export function setupIncomingMessages(
    sock: WASocket,
    accountPhone: string
): void {

    sock.ev.on('messages.upsert', async ({ messages, type }) => {

        if (type !== 'notify') return;

        for (const message of messages) {

            if (message.key.fromMe || !message.message) {
                continue;
            }

            const jid = message.key.remoteJid;

            if (!jid) continue;

            if (jid === 'status@broadcast') continue;

            if (jid.endsWith('@newsletter')) continue;

            if (jid.endsWith('@g.us')) continue;

            const text = utils.getText(message).trim();

            if (!text) continue;

            const incomingMessage = {
                accountPhone,
                messageId: message.key.id ?? null,
                senderJid: jid,
                senderLid: message.key.senderLid,
                senderPn: message.key.senderPn,
                receivedAt: new Date().toISOString(),
                text,
            };

            console.log(
                `[${accountPhone}] Incoming message:`,
                incomingMessage
            );

            emit(
                'whatsapp:incoming-message',
                incomingMessage
            );

            if (text.toLowerCase() === '!ping') {

                try {

                    await sock.sendMessage(jid, {
                        text: 'Pong! 🟢 CayaBot is working.',
                    });

                    console.log(
                        `[${accountPhone}] Pong sent to ${jid}`
                    );

                } catch (error) {

                    console.error(
                        `[${accountPhone}] Failed to reply to ${jid}:`,
                        error
                    );
                }
            }
        }
    });
}