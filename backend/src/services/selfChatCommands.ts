import {
    jidNormalizedUser,
    type WASocket,
} from '@whiskeysockets/baileys';

import { randomUUID } from 'node:crypto';

import {
    emit,
    type SendMessagesJob,
} from '../config/eventEmitter.js';

import * as utils from '../utils/selfChatUtils.js';


const APPEND_CLOCK_TOLERANCE_MS = 60_000;


export function setupSelfChatCommands(
    sock: WASocket,
    accountPhone: string
): void {

    const listenerStartedAt = Date.now();

    sock.ev.on('messages.upsert', async ({ messages, type }) => {

        if (type !== 'notify' && type !== 'append') {
            return;
        }

        const selfJids = utils.getSelfJids(
            sock,
            accountPhone
        );

        for (const message of messages) {

            if (!message.message) continue;

            const jid = message.key.remoteJid;

            if (!jid || jid === 'status@broadcast') continue;

            if (
                jid.endsWith('@newsletter') ||
                jid.endsWith('@g.us')
            ) {
                continue;
            }

            if (message.key.fromMe !== true) continue;

            const normalizedJid = jidNormalizedUser(jid);

            const isSelfChat = selfJids.has(normalizedJid);

            if (!isSelfChat) continue;

            if (type === 'append') {

                const timestamp = Number(
                    message.messageTimestamp
                );

                const timestampMs = timestamp * 1000;

                const isRecent =
                    Number.isFinite(timestampMs) &&
                    timestampMs > 0 &&
                    timestampMs >=
                        listenerStartedAt - APPEND_CLOCK_TOLERANCE_MS;

                if (!isRecent) {
                    console.log(
                        `[${accountPhone}] Ignoring old self-chat history message:`,
                        message.key.id
                    );

                    continue;
                }
            }

            const messageId = message.key.id;

            if (!messageId) continue;

            const uniqueId = `${accountPhone}:${messageId}`;

            if (utils.processedMessages.has(uniqueId)) {
                continue;
            }

            const text = utils.getText(message).trim();

            if (!text) continue;

            console.log(
                `[${accountPhone}] SELF-CHAT EVENT:`,
                {
                    type,
                    fromMe: message.key.fromMe,
                    remoteJid: jid,
                    normalizedJid,
                    messageId,
                    textPreview: text.slice(0, 100),
                }
            );

            utils.processedMessages.add(uniqueId);

            if (utils.processedMessages.size > 1000) {

                const oldest =
                    utils.processedMessages.values().next().value;

                if (oldest) {
                    utils.processedMessages.delete(oldest);
                }
            }

            console.log(
                `[${accountPhone}] Self-chat command:`,
                text
            );

            try {

                if (text.toLowerCase() === 'cayabot') {

                    await utils.showInstructions(
                        sock,
                        jid
                    );

                    console.log(
                        `[${accountPhone}] Instructions submitted successfully.`
                    );

                    continue;
                }

                if (!/^SEND(?:\r?\n|$)/i.test(text)) {
                    continue;
                }

                const data = utils.parseSendData(text);

                const batchSize =
                    utils.MAX_RECIPIENTS_PER_BATCH;

                const jobs: SendMessagesJob[] = [];

                for (
                    let i = 0;
                    i < data.recipients.length;
                    i += batchSize
                ) {

                    const recipients = data.recipients.slice(
                        i,
                        i + batchSize
                    );

                    jobs.push({
                        jobId: randomUUID(),
                        accountPhone,
                        message: data.message,
                        recipients,
                        createdAt: new Date().toISOString(),
                    });
                }

                let acceptedJobs = 0;

                for (const job of jobs) {

                    const accepted = emit(
                        'job:sendMessages',
                        job
                    );

                    if (!accepted) break;

                    acceptedJobs++;
                }

                const acceptedRecipients = jobs
                    .slice(0, acceptedJobs)
                    .reduce(
                        (total, job) =>
                            total + job.recipients.length,
                        0
                    );

                if (acceptedJobs !== jobs.length) {

                    await utils.sendSelf(
                        sock,
                        jid,
                        acceptedJobs === 0
                            ? '⚠️ CayaBot message queue is unavailable. No batches were accepted.'
                            : (
                                `⚠️ Only ${acceptedJobs}/${jobs.length} batches were accepted.\n\n` +
                                `Recipients queued: ${acceptedRecipients}/${data.recipients.length}.\n` +
                                `Check accepted jobs before retrying to avoid duplicate messages.`
                            )
                    );

                    continue;
                }

                const batchSummary = jobs.map(
                    (job, index) => {

                        const start =
                            index * batchSize + 1;

                        const end =
                            start + job.recipients.length - 1;

                        return (
                            `Batch ${index + 1}: Recipients ${start}-${end}\n` +
                            `Job ID: ${job.jobId}`
                        );
                    }
                ).join('\n\n');

                console.log(
                    `[${accountPhone}] Queued ${jobs.length} batches for ${data.recipients.length} recipients.`
                );

                await utils.sendSelf(
                    sock,
                    jid,
                    `✅ Your campaign has been queued successfully!\n\n` +
                    `Account: ${accountPhone}\n` +
                    `Total recipients: ${data.recipients.length}\n` +
                    `Total batches: ${jobs.length}\n\n` +
                    `BATCH DETAILS\n\n${batchSummary}\n\n` +
                    `CayaBot will now process your batches.`
                );

            } catch (error) {

                const errorMessage =
                    error instanceof Error
                        ? error.message
                        : 'An unexpected error occurred.';

                console.error(
                    `[${accountPhone}] Self-chat command failed:`,
                    error
                );

                await utils.sendSelf(
                    sock,
                    jid,
                    `❌ ${errorMessage}\n\nSend CAYABOT to see the instructions again.`
                ).catch(console.error);
            }
        }
    });
}