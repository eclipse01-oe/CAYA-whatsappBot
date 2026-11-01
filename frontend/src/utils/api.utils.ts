import type {
    ApiResponse,
    CampaignPayload,
    CampaignResponse,
} from './app.types';

const API_URL = 'http://localhost:3000/api';

export async function regStatus(
    phone: string
): Promise<ApiResponse> {

    const res = await fetch(
        `${API_URL}/reg/phone`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ phone }),
        }
    );

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

    const res = await fetch(
        `${API_URL}/campaign/jobs`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
        }
    );

    const data = await res.json() as CampaignResponse;

    if (!res.ok) {
        throw new Error(
            data.message ?? 'Campaign submission failed.'
        );
    }

    return data;
}