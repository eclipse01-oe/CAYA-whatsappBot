import './utils/messageQueue.js';
import { app } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, '0.0.0.0', () => {
    console.log('Server 🔌 started at port', PORT);
    console.log(`Running at http://localhost:${PORT}`);
});