import {
    emit,
    whatsAppEmitter,
    type SendMessagesJob,
    type Recipient,
} from '../config/eventEmitter.js';

import {
    sendWhatsAppMessage,
    sendWhatsAppSelfMessage,
    isWhatsAppConnected,
} from '../config/whatsappBot.js';


interface QueueTask extends Recipient {
    jobId: string;
    campaignId: string;
    batchNumber: number;
    totalBatches: number;
    accountPhone: string;
    template: string;
    attempts: number;
}

interface JobProgress {
    campaignId: string;
    batchNumber: number;
    totalBatches: number;
    total: number;
    pending: number;
    sent: number;
    failed: number;
}


const MAX_ATTEMPTS = 3;
const SEND_DELAY_MS = 1000;
const RETRY_DELAY_MS = 2000;

const sendQueue: QueueTask[] = [];

const jobs = new Map<string, JobProgress>();

let processing = false;

const STATUS_PREFIX = '[CAYABOT_STATUS]';


const delay = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));


function getErrorMessage(error: unknown): string {
    return error instanceof Error
        ? error.message
        : String(error);
}


function notifySelfChat(
    accountPhone: string,
    message: string
): void {

    void sendWhatsAppSelfMessage(
        accountPhone,
        `${STATUS_PREFIX}\n\n${message}`
    ).catch(error => {
        console.error(
            `Could not send task update to ${accountPhone}:`,
            error
        );
    });
}


async function updateProgress(
    task: QueueTask,
    status: 'sent' | 'failed',
    details: {
        messageId?: string | null;
        error?: string;
    } = {}
): Promise<void> {

    const progress = jobs.get(task.jobId);

    if (!progress) return;

    progress.pending--;
    progress[status]++;

    const summary = {
        total: progress.total,
        pending: progress.pending,
        sent: progress.sent,
        failed: progress.failed,
    };

    emit('job:progress', {
        campaignId: task.campaignId,
        jobId: task.jobId,
        batchNumber: task.batchNumber,
        totalBatches: task.totalBatches,
        accountPhone: task.accountPhone,
        status,
        recipient: {
            name: task.name,
            phone: task.phone,
        },
        ...details,
        summary,
    });

    if (progress.pending === 0) {

        emit('job:completed', {
            campaignId: task.campaignId,
            jobId: task.jobId,
            batchNumber: task.batchNumber,
            totalBatches: task.totalBatches,
            accountPhone: task.accountPhone,
            summary,
        });

        jobs.delete(task.jobId);

        notifySelfChat(
            task.accountPhone,
            [
                '🏁 BATCH COMPLETED',
                `Campaign ID: ${task.campaignId}`,
                `Job ID: ${task.jobId}`,
                `Batch: ${task.batchNumber}/${task.totalBatches}`,
                `Total recipients: ${summary.total}`,
                `✅ Successfully sent: ${summary.sent}`,
                `❌ Failed: ${summary.failed}`,
            ].join('\n')
        );
    }
}


async function processQueue(): Promise<void> {

    if (processing) return;

    processing = true;

    try {

        while (sendQueue.length > 0) {

            const index = sendQueue.findIndex(task =>
                isWhatsAppConnected(task.accountPhone)
            );

            if (index === -1) break;

            const task = sendQueue[index];

            if (!task) break;

            const personalizedMessage = task.template.replaceAll(
                '${name}',
                task.name
            );

            try {

                const messageId = await sendWhatsAppMessage(
                    task.accountPhone,
                    task.jid,
                    personalizedMessage
                );

                if (!messageId) {
                    throw new Error(
                        'Message ID was not returned.'
                    );
                }

                sendQueue.splice(index, 1);

                emit('message:sent', {
                    campaignId: task.campaignId,
                    jobId: task.jobId,
                    batchNumber: task.batchNumber,
                    totalBatches: task.totalBatches,
                    accountPhone: task.accountPhone,
                    name: task.name,
                    phone: task.phone,
                    jid: task.jid,
                    messageId,
                    sentAt: new Date().toISOString(),
                });

                notifySelfChat(
                    task.accountPhone,
                    [
                        '✅ MESSAGE SUBMITTED',
                        `Name: ${task.name}`,
                        `Number: ${task.phone}`,
                        `Campaign ID: ${task.campaignId}`,
                        `Job ID: ${task.jobId}`,
                    ].join('\n')
                );

                await updateProgress(task, 'sent', {
                    messageId,
                });

                console.log(
                    `[${task.accountPhone}] Message submitted to ${task.phone}`
                );

            } catch (error) {

                if (!isWhatsAppConnected(task.accountPhone)) {

                    emit('job:progress', {
                        campaignId: task.campaignId,
                        jobId: task.jobId,
                        batchNumber: task.batchNumber,
                        totalBatches: task.totalBatches,
                        accountPhone: task.accountPhone,
                        status: 'waiting-for-connection',
                        recipient: {
                            name: task.name,
                            phone: task.phone,
                        },
                    });

                    break;
                }

                task.attempts++;

                const errorMessage = getErrorMessage(error);

                console.error(
                    `Attempt ${task.attempts} failed for ${task.phone}:`,
                    error
                );

                if (task.attempts < MAX_ATTEMPTS) {

                    emit('job:progress', {
                        campaignId: task.campaignId,
                        jobId: task.jobId,
                        batchNumber: task.batchNumber,
                        totalBatches: task.totalBatches,
                        accountPhone: task.accountPhone,
                        status: 'retrying',
                        recipient: {
                            name: task.name,
                            phone: task.phone,
                        },
                        attempt: task.attempts,
                        error: errorMessage,
                    });

                    notifySelfChat(
                        task.accountPhone,
                        [
                            '⚠️ MESSAGE SEND ERROR',
                            `Recipient: ${task.name}`,
                            `Number: ${task.phone}`,
                            `Attempt: ${task.attempts}/${MAX_ATTEMPTS}`,
                            `Error: ${errorMessage}`,
                            'Retrying...',
                        ].join('\n')
                    );

                    await delay(RETRY_DELAY_MS);

                    continue;
                }

                sendQueue.splice(index, 1);

                emit('message:failed', {
                    campaignId: task.campaignId,
                    jobId: task.jobId,
                    batchNumber: task.batchNumber,
                    totalBatches: task.totalBatches,
                    accountPhone: task.accountPhone,
                    recipient: {
                        name: task.name,
                        phone: task.phone,
                    },
                    attempts: task.attempts,
                    error: errorMessage,
                    failedAt: new Date().toISOString(),
                });

                notifySelfChat(
                    task.accountPhone,
                    [
                        '❌ MESSAGE FAILED',
                        `Recipient: ${task.name}`,
                        `Number: ${task.phone}`,
                        `Attempts: ${MAX_ATTEMPTS}`,
                        `Error: ${errorMessage}`,
                    ].join('\n')
                );

                await updateProgress(task, 'failed', {
                    error: errorMessage,
                });
            }

            if (sendQueue.length > 0) {
                await delay(SEND_DELAY_MS);
            }
        }

    } finally {

        processing = false;

        if (
            sendQueue.some(task =>
                isWhatsAppConnected(task.accountPhone)
            )
        ) {
            setImmediate(() => {
                void processQueue();
            });
        }
    }
}


whatsAppEmitter.on(
    'job:sendMessages',
    (job: SendMessagesJob) => {

        if (jobs.has(job.jobId)) {
            console.warn(
                `Duplicate job ignored: ${job.jobId}`
            );

            return;
        }

        const campaignId = job.campaignId ?? job.jobId;
        const batchNumber = job.batchNumber ?? 1;
        const totalBatches = job.totalBatches ?? 1;

        const tasks: QueueTask[] = job.recipients.map(
            recipient => ({
                ...recipient,
                jobId: job.jobId,
                campaignId,
                batchNumber,
                totalBatches,
                accountPhone: job.accountPhone,
                template: job.message,
                attempts: 0,
            })
        );

        if (tasks.length === 0) {

            emit('job:completed', {
                campaignId,
                jobId: job.jobId,
                batchNumber,
                totalBatches,
                accountPhone: job.accountPhone,
                summary: {
                    total: 0,
                    pending: 0,
                    sent: 0,
                    failed: 0,
                },
            });

            return;
        }

        jobs.set(job.jobId, {
            campaignId,
            batchNumber,
            totalBatches,
            total: tasks.length,
            pending: tasks.length,
            sent: 0,
            failed: 0,
        });

        sendQueue.push(...tasks);

        emit('job:progress', {
            campaignId,
            jobId: job.jobId,
            batchNumber,
            totalBatches,
            accountPhone: job.accountPhone,
            status: 'queued',
            total: tasks.length,
        });

        notifySelfChat(
            job.accountPhone,
            [
                '📥 NEW BATCH ACCEPTED',
                `Campaign ID: ${campaignId}`,
                `Job ID: ${job.jobId}`,
                `Batch: ${batchNumber}/${totalBatches}`,
                `Recipients: ${tasks.length}`,
                'Status: Queued for delivery.',
            ].join('\n')
        );

        void processQueue();
    }
);


whatsAppEmitter.on(
    'whatsApp:connection-status',
    (event: {
        phoneNumber: string;
        status: string;
    }) => {

        if (event.status !== 'connected') return;

        const pending = sendQueue.filter(
            task => task.accountPhone === event.phoneNumber
        );

        if (pending.length > 0) {

            notifySelfChat(
                event.phoneNumber,
                [
                    '🔄 CONNECTION RESTORED',
                    `${pending.length} pending message(s) will resume.`,
                ].join('\n')
            );

            void processQueue();
        }
    }
);


console.log('WhatsApp message queue initialized.');