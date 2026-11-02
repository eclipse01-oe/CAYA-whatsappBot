import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    jidNormalizedUser,
    type WASocket,
} from '@whiskeysockets/baileys';

import pino from 'pino';

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
    getDisconnectStatus,
    reportFatalSession,
} from '../utils/whatsAppError.js';

import { emit } from './eventEmitter.js';

import { setupSelfChatCommands } from '../services/selfChatCommands.js';
import { setupIncomingMessages } from '../services/incomingMessages.js';



const AUTH_ROOT = path.resolve(
    process.cwd(),
    'auth_info_baileys'
);

const CONNECT_TIMEOUT_MS = 60_000;
const RECONNECT_BASE_DELAY_MS = 2_000;
const RECONNECT_MAX_DELAY_MS = 30_000;
const PAIRING_RESTART_DELAY_MS = 750;


const activeSockets = new Map<string, WASocket>();

const connectedAccounts = new Set<string>();

const startingAccounts = new Map<
    string,
    Promise<WASocket | undefined>
>();

const reconnectAttempts = new Map<string, number>();

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
}



export function getWhatsAppSocket(
    phone: string
): WASocket | undefined {
    return activeSockets.get(normalizePhone(phone));
}

export function isWhatsAppConnected(phone: string): boolean {
    return connectedAccounts.has(normalizePhone(phone));
}

export async function sendWhatsAppMessage(
    accountPhone: string,
    jid: string,
    text: string
): Promise<string | null> {

    const phone = normalizePhone(accountPhone);

    const sock = activeSockets.get(phone);

    if (!sock || !connectedAccounts.has(phone)) {
        throw new Error(
            `WhatsApp account ${phone} is not connected.`
        );
    }

    const result = await sock.sendMessage(jid, { text });

    if (!result) {
        throw new Error('WhatsApp returned no send result.');
    }

    return result.key.id ?? null;
}


export async function sendWhatsAppSelfMessage(
    accountPhone: string,
    text: string
): Promise<string | null> {

    const phone = normalizePhone(accountPhone);

    const sock = activeSockets.get(phone);

    if (!sock || !connectedAccounts.has(phone)) {
        throw new Error(
            `WhatsApp account ${phone} is not connected.`
        );
    }

    const ownJid = sock.user?.id;

    if (!ownJid) {
        throw new Error(
            `Could not determine the WhatsApp JID for ${phone}.`
        );
    }

    const selfJid = jidNormalizedUser(ownJid);

    const result = await sock.sendMessage(selfJid, {
        text,
    });

    if (!result) {
        throw new Error(
            `Failed to send self-chat message for ${phone}.`
        );
    }

    return result.key.id ?? null;
}



async function startAccount(
    phoneNumber: string
): Promise<WASocket | undefined> {

    const AUTH_DIR = path.join(
        AUTH_ROOT,
        phoneNumber
    );

    const SESSION_REVOKED_MARKER = path.join(
        AUTH_DIR,
        '.session-revoked'
    );

    if (existsSync(SESSION_REVOKED_MARKER)) {

        console.error(
            `[${phoneNumber}] Saved session was rejected.`
        );

        emit('whatsApp:connection-status', {
            phoneNumber,
            status: 'session-revoked',
        });

        return undefined;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

    console.log(
        state.creds.registered
            ? `[${phoneNumber}] Saved credentials found.`
            : `[${phoneNumber}] New WhatsApp registration required.`
    );

    let credentialSaveQueue: Promise<void> = Promise.resolve();

    function persistCredentials(): Promise<void> {
        credentialSaveQueue = credentialSaveQueue
            .catch(() => undefined)
            .then(() => saveCreds())
            .catch((error: unknown) => {
                console.error(
                    `[${phoneNumber}] Failed to save credentials:`,
                    error
                );
            });

        return credentialSaveQueue;
    }

    const sock = makeWASocket({
        auth: state,
        logger: pino({
            level: process.env.LOG_LEVEL ?? 'info',
        }),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        connectTimeoutMs: CONNECT_TIMEOUT_MS,
    });

    activeSockets.set(phoneNumber, sock);
    connectedAccounts.delete(phoneNumber);

    let pairingCodeRequested = false;
    let reconnectScheduled = false;
    

    setupSelfChatCommands(sock, phoneNumber);

    setupIncomingMessages(sock, phoneNumber);


    sock.ev.on(
        'connection.update',
        async ({ connection, qr, lastDisconnect }) => {

            const statusCode = getDisconnectStatus(
                lastDisconnect?.error
            );

            console.log(`[${phoneNumber}] Connection update:`, {
                connection,
                qrReceived: Boolean(qr),
                statusCode,
            });

            if (connection) {
                emit('whatsApp:connection-status', {
                    phoneNumber,
                    status:
                        connection === 'open'
                            ? 'connected'
                            : connection === 'close'
                                ? 'disconnected'
                                : 'connecting',
                    statusCode,
                    timestamp: new Date().toISOString(),
                });
            }

            if (
                qr &&
                !state.creds.registered &&
                !pairingCodeRequested
            ) {
                pairingCodeRequested = true;

                try {
                    const code = await sock.requestPairingCode(
                        phoneNumber
                    );

                    console.log(
                        `[${phoneNumber}] Pairing code generated.`
                    );

                    emit('whatsapp:connection-code', {
                        phoneNumber,
                        code,
                    });

                    emit('whatsApp:connection-status', {
                        phoneNumber,
                        status: 'pairing-code-generated',
                    });

                } catch (error) {
                    pairingCodeRequested = false;

                    console.error(
                        `[${phoneNumber}] Pairing code error:`,
                        error
                    );

                    emit('whatsApp:connection-status', {
                        phoneNumber,
                        status: 'pairing-failed',
                    });
                }
            }


            if (connection === 'open') {

                reconnectAttempts.set(phoneNumber, 0);
                connectedAccounts.add(phoneNumber);

                console.log(
                    `[${phoneNumber}] WhatsApp connected successfully!`
                );

                emit('whatsApp:connection-status', {
                    phoneNumber,
                    status: 'connected',
                });

            }

            if (connection !== 'close') return;

            connectedAccounts.delete(phoneNumber);

            if (activeSockets.get(phoneNumber) === sock) {
                activeSockets.delete(phoneNumber);
            }

            console.error(
                `[${phoneNumber}] WhatsApp connection closed:`,
                statusCode
            );

            if (statusCode === DisconnectReason.loggedOut) {

                try {
                    await mkdir(AUTH_DIR, { recursive: true });

                    await writeFile(
                        SESSION_REVOKED_MARKER,
                        JSON.stringify({
                            phoneNumber,
                            statusCode,
                            revokedAt: new Date().toISOString(),
                        }, null, 2),
                        'utf8'
                    );

                } catch (error) {
                    console.error(
                        'Failed to save revocation marker:',
                        error
                    );
                }

                emit('whatsApp:connection-status', {
                    phoneNumber,
                    status: 'session-revoked',
                    statusCode,
                });

                return;
            }

            if (
                statusCode === DisconnectReason.connectionReplaced ||
                statusCode === DisconnectReason.badSession ||
                statusCode === DisconnectReason.forbidden ||
                statusCode === DisconnectReason.multideviceMismatch
            ) {
                reportFatalSession(statusCode);

                emit('whatsApp:connection-status', {
                    phoneNumber,
                    status: 'connection-error',
                    statusCode,
                });

                return;
            }

            if (reconnectScheduled) return;

            reconnectScheduled = true;


            const isPairingRestart =
                statusCode === DisconnectReason.restartRequired;

            await persistCredentials();

            const attempts =
                reconnectAttempts.get(phoneNumber) ?? 0;

            const reconnectDelay = isPairingRestart
                ? PAIRING_RESTART_DELAY_MS
                : Math.min(
                    RECONNECT_BASE_DELAY_MS * 2 ** attempts,
                    RECONNECT_MAX_DELAY_MS
                );

            if (!isPairingRestart) {
                reconnectAttempts.set(
                    phoneNumber,
                    attempts + 1
                );
            }

            console.log(
                `[${phoneNumber}] Reconnecting in ${reconnectDelay}ms...`
            );

            await delay(reconnectDelay);

            void whatsappBot(phoneNumber).catch(console.error);
        }
    );

    return sock;
}



export async function whatsappBot(
    number: string
): Promise<WASocket | undefined> {

    const phoneNumber = normalizePhone(number);

    if (!/^[1-9]\d{7,14}$/.test(phoneNumber)) {
        throw new Error('Invalid international phone number.');
    }

    const existingSocket = activeSockets.get(phoneNumber);

    if (existingSocket) {
        return existingSocket;
    }

    const existingStart = startingAccounts.get(phoneNumber);

    if (existingStart) {
        return existingStart;
    }

    const starting = startAccount(phoneNumber).finally(() => {
        startingAccounts.delete(phoneNumber);
    });

    startingAccounts.set(phoneNumber, starting);

    return starting;
}