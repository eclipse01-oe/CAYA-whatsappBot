import type { ApiResponse, CampaignPayload, CampaignResponse } from './app.types';

// const BASE_URL = import.meta.env.VITE_API_URL
// const API_URL = `${BASE_URL}/api`;
export const API_BASE_URL = '/api';

export async function regStatus(
    phone: string
): Promise<ApiResponse> {

    const res = await fetch(`${API_BASE_URL}/reg/phone`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ phone }),
    });

    const data = await res.json() as ApiResponse;

    if (!res.ok) {
        throw new Error(
            data.message ?? `HTTP error: ${res.status}`
        );
    }

    return data;
}

export async function submitCampaign(
    payload: CampaignPayload
): Promise<CampaignResponse> {

    const res = await fetch(`${API_BASE_URL}/campaign/jobs`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });

    const data = await res.json() as CampaignResponse;

    if (!res.ok) {
        throw new Error(
            data.message ?? 'Campaign submission failed.'
        );
    }

    return data;
}