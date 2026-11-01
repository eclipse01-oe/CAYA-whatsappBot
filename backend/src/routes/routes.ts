import { Router } from 'express';

import { getPhone, sendCampaign } from '../controllers/process.js';
import { whatsappStream } from '../controllers/whatsappStatusStream.js';

export const whatsappRouter = Router();

whatsappRouter.post('/api/reg/phone', getPhone);

whatsappRouter.get('/api/connection/stream', whatsappStream);

whatsappRouter.post('/api/campaign/jobs', sendCampaign);