export interface ConnectionCode {
    code: string;
    phoneNumber: string;
}

export interface ConnectionEvent {
    status: string;
    statusCode?: number;
}

export interface ApiResponse {
    message: string;
}

export interface Recipient {
    name: string;
    phone: string;
}

export interface CampaignPayload {
    accountPhone: string;
    message: string;
    recipients: Recipient[];
}

export interface CampaignResponse {
    success: boolean;
    campaignId?: string;
    status?: string;
    message: string;
    totalRecipients?: number;
    queuedRecipients?: number;
    totalBatches?: number;
    acceptedBatches?: number;
}

export interface CampaignProgressEvent {
    status: string;
    recipient?: string | {
        name?: string;
        phone?: string;
    };
}

export interface CampaignCompletedEvent {
    summary: {
        sent: number;
        failed: number;
    };
}

export interface PersistedAppData {
    input: string;
    connectionStatus: string[];
    message: string;
    recipientData: string;
    campaignStatus: string[];
}