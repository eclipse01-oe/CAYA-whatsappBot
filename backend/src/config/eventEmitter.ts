import { EventEmitter } from 'node:events';

export interface SendRecipient {
    name: string;
    phone: string;
    jid: string;
}

export interface Recipient {
    name: string;
    phone: string;
    jid: string;
}

export interface SendMessagesJob {
    jobId: string;
    campaignId?: string;
    batchNumber?: number;
    totalBatches?: number;
    accountPhone: string;
    message: string;
    recipients: Recipient[];
    createdAt: string;
}

export const whatsAppEmitter = new EventEmitter();

type EventHandler<T> = (event: T) => void | Promise<void>;

export const emit = <T>(
    eventName: string,
    payload: T
): boolean => {
    return whatsAppEmitter.emit(eventName, payload);
};

export const listen = <T>(
    eventName: string,
    handler: EventHandler<T>
): (() => void) => {

    const wrappedHandler = (event: T): void => {

        try {
            void Promise.resolve(handler(event)).catch(
                (error: unknown) => {
                    console.error(
                        `Error handling "${eventName}" event:`,
                        error
                    );
                }
            );

        } catch (error) {
            console.error(
                `Error handling "${eventName}" event:`,
                error
            );
        }
    };

    whatsAppEmitter.on(eventName, wrappedHandler);

    return () => {
        whatsAppEmitter.off(eventName, wrappedHandler);
    };
};