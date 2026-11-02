import {
    jidNormalizedUser,
    type WASocket,
    type WAMessage
} from '@whiskeysockets/baileys';

import type { Recipient } from '../config/eventEmitter.js';


export const MAX_TOTAL_RECIPIENTS = 100;
export const MAX_RECIPIENTS_PER_BATCH = 20;
export const processedMessages = new Set<string>();
type StoredMessage = NonNullable<WAMessage['message']>;
const retryMessageStore = new Map<string, StoredMessage>();
const MAX_RETRY_MESSAGES = 1000;


export const rememberMessage = (message: WAMessage): void => {

    const messageId = message.key.id;

    if (!messageId || !message.message) return;

    retryMessageStore.delete(messageId);

    retryMessageStore.set(messageId, message.message);

    while (retryMessageStore.size > MAX_RETRY_MESSAGES) {

        const oldest = retryMessageStore.keys().next().value;

        if (oldest) {
            retryMessageStore.delete(oldest);
        }
    }
};


export const getStoredMessage = (
    messageId?: string
): StoredMessage | undefined => {

    if (!messageId) return undefined;

    const message = retryMessageStore.get(messageId);

    console.log(
        `[CAYA] Message retry lookup: ${messageId} - ${message ? 'FOUND' : 'NOT FOUND'}`
    );

    return message;
};


export const getSelfJids = (
    sock: WASocket,
    accountPhone: string
): Set<string> => {

    const user = sock.user as (
        typeof sock.user & { lid?: string }
    ) | undefined;

    const identities = [
        user?.id,
        user?.lid,
        `${accountPhone}@s.whatsapp.net`,
    ].filter((jid): jid is string => Boolean(jid));

    return new Set(identities.map(jidNormalizedUser));
};


type TextMessage = { message?: {
        conversation?: string | null;
        extendedTextMessage?: {text?: string | null} | null;
        imageMessage?: {caption?: string | null} | null;
        videoMessage?: {caption?: string | null} | null;
    } | null;
};


export const getText = (message: TextMessage): string => {

    const content = message.message;

    return (
        content?.conversation ??
        content?.extendedTextMessage?.text ??
        content?.imageMessage?.caption ??
        content?.videoMessage?.caption ??
        ''
    );
};


export const sendSelf = async (
    sock: WASocket,
    jid: string,
    text: string
): Promise<void> => {

    await sock.sendMessage(jid, { text });
};


export const showInstructions = async (
    sock: WASocket,
    jid: string
): Promise<void> => {

    const instructions = `
Welcome to CayaBot! 👋

I can help you send personalized WhatsApp messages to multiple recipients.

HOW TO SEND:

SEND
Message: Hello \${name}, welcome to CAYA!
---
1. Emmanuel | 2348035140268
2. David | 2348012345678
3. Sarah | +254708920430

MESSAGE INSTRUCTIONS:

1. Start with SEND.
2. Message: contains your message template.
3. Use \${name} wherever you want the recipient's name.
4. Separate the message and recipients using ---
5. Put each recipient on a new line.

RECIPIENT FORMATS:

Emmanuel | 2348035140268
David — 08012345678
Sarah - +254708920430

Numbered lists:
1. Emmanuel | 08012345678
2) David | 09012345678
3 - Sarah | +254708920430

Bulleted lists:
• Emmanuel | 08012345678
- David | 09012345678
* Sarah | +254708920430

PHONE NUMBER HANDLING:

Nigerian local numbers beginning with 0 are automatically converted to international format.

Example:
08012345678 → 2348012345678

International numbers should include their country code.

BATCH PROCESSING:

Maximum recipients per command: ${MAX_TOTAL_RECIPIENTS}.

CayaBot automatically splits your recipients into groups of ${MAX_RECIPIENTS_PER_BATCH}.

You don't need to split large recipient lists yourself.

Other rules:
- Duplicate phone numbers are rejected.
- Invalid phone numbers are reported.
- Each batch receives its own job ID.

Send CAYABOT anytime to see these instructions again.
    `.trim();

    await sendSelf(sock, jid, instructions);
};

const cleanRecipientPrefix = (line: string): string => {

    let cleaned = line.trim();

    while (true) {

        const next = cleaned.replace(
            /^(?:\d+\s*[.)\-:]\s*|[•●▪◦‣*-]\s*)/u,
            ''
        ).trim();

        if (next === cleaned) break;

        cleaned = next;
    }

    return cleaned;
};


const cleanPhoneNumber = (value: string): string => {

    const input = value.trim();

    if (!/^\+?[\d\s().-]+$/.test(input)) {
        return '';
    }

    let phone = input.replace(/\D/g, '');

    if (phone.startsWith('00')) {
        phone = phone.slice(2);
    }

    else if (/^0\d{10}$/.test(phone)) {
        phone = `234${phone.slice(1)}`;
    }

    return phone;
};

const parseRecipientLine = (
    line: string
): { name: string; phone: string } | null => {

    const cleanedLine = cleanRecipientPrefix(line);

    if (!cleanedLine) return null;

    const match =
        cleanedLine.match(
            /^(.+?)\s*(?:\||—|–|:)\s*(.+)$/
        ) ??
        cleanedLine.match(
            /^(.+?)\s+-\s+(.+)$/
        );

    if (!match) return null;

    return {
        name: match[1].trim(),
        phone: cleanPhoneNumber(match[2]),
    };
};


export const parseSendData = (
    text: string
): {
    message: string;
    recipients: Recipient[];
} => {

    const lines = text
        .replace(/\r/g, '')
        .split('\n');

    if (lines[0]?.trim().toUpperCase() !== 'SEND') {
        throw new Error(
            'Your message must start with SEND.'
        );
    }

    const separatorIndex = lines.findIndex(
        (line, index) =>
            index > 0 && line.trim() === '---'
    );

    if (separatorIndex < 2) {
        throw new Error(
            'Missing --- separator between message and recipients.'
        );
    }

    const messageLines = lines.slice(1, separatorIndex);

    const headerIndex = messageLines.findIndex(
        line => line.trim().length > 0
    );

    if (headerIndex === -1) {
        throw new Error(
            'Please provide a message template.'
        );
    }

    const messageHeader = messageLines[headerIndex].match(
        /^message\s*:\s*(.*)$/i
    );

    if (!messageHeader) {
        throw new Error(
            'Please start your message with Message:'
        );
    }

    const message = [
        messageHeader[1],
        ...messageLines.slice(headerIndex + 1),
    ].join('\n').trim();

    if (!message) {
        throw new Error(
            'Message template cannot be empty.'
        );
    }

    const recipientLines = lines
        .slice(separatorIndex + 1)
        .filter(line => line.trim().length > 0);

    if (recipientLines.length === 0) {
        throw new Error(
            'No recipients were provided.'
        );
    }

    if (recipientLines.length > MAX_TOTAL_RECIPIENTS) {
        throw new Error(
            `Maximum of ${MAX_TOTAL_RECIPIENTS} recipients allowed per command.`
        );
    }

    const recipients: Recipient[] = [];

    const seenPhones = new Set<string>();

    for (let i = 0; i < recipientLines.length; i++) {

        const parsed = parseRecipientLine(
            recipientLines[i]
        );

        if (!parsed) {
            throw new Error(
                `Invalid recipient entry ${i + 1}. Use Name | Phone.`
            );
        }

        const { name, phone } = parsed;

        if (!name) {
            throw new Error(
                `Recipient ${i + 1} has no name.`
            );
        }

        if (!/^[1-9]\d{7,14}$/.test(phone)) {
            throw new Error(
                `Invalid phone number for ${name}: "${recipientLines[i]}". Please provide a valid international number.`
            );
        }

        // Reject duplicate recipients.
        if (seenPhones.has(phone)) {
            throw new Error(
                `Duplicate phone number detected for ${name}: ${phone}.`
            );
        }

        seenPhones.add(phone);

        recipients.push({
            name,
            phone,
            jid: `${phone}@s.whatsapp.net`,
        });
    }

    return {
        message,
        recipients,
    };
};


const isRecord = (
    value: unknown
): value is Record<string, unknown> => {

    return (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
    );
};


export const prepareCampaignData = (
    input: unknown
): {
    message: string;
    recipients: Recipient[];
} => {

    if (!isRecord(input)) {
        throw new Error('Invalid campaign data.');
    }

    if (
        typeof input.message !== 'string' ||
        !input.message.trim()
    ) {
        throw new Error(
            'A valid message template is required.'
        );
    }

    const message = input.message.trim();

    if (!Array.isArray(input.recipients)) {
        throw new Error(
            'Recipients must be provided as an array.'
        );
    }

    const rawRecipients = input.recipients;

    if (rawRecipients.length === 0) {
        throw new Error('No recipients were provided.');
    }

    if (rawRecipients.length > MAX_TOTAL_RECIPIENTS) {
        throw new Error(
            `Maximum of ${MAX_TOTAL_RECIPIENTS} recipients allowed.`
        );
    }

    const recipients: Recipient[] = [];

    const seenPhones = new Set<string>();

    for (let i = 0; i < rawRecipients.length; i++) {

        const rawRecipient = rawRecipients[i];

        if (!isRecord(rawRecipient)) {
            throw new Error(
                `Invalid recipient at position ${i + 1}.`
            );
        }

        const { name, phone } = rawRecipient;

        if (
            typeof name !== 'string' ||
            !name.trim()
        ) {
            throw new Error(
                `Recipient ${i + 1} must have a valid name.`
            );
        }

        if (
            typeof phone !== 'string' ||
            !phone.trim()
        ) {
            throw new Error(
                `A phone number is required for ${name}.`
            );
        }

        const normalizedPhone = cleanPhoneNumber(phone);

        if (!/^[1-9]\d{7,14}$/.test(normalizedPhone)) {
            throw new Error(
                `Invalid phone number for ${name}: ${phone}.`
            );
        }

        if (seenPhones.has(normalizedPhone)) {
            throw new Error(
                `Duplicate phone number detected: ${normalizedPhone}.`
            );
        }

        seenPhones.add(normalizedPhone);

        recipients.push({
            name: name.trim(),
            phone: normalizedPhone,
            jid: `${normalizedPhone}@s.whatsapp.net`,
        });
    }

    return {
        message,
        recipients,
    };
};