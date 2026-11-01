import 'dotenv/config'
import './utils/messageQueue.js';
import { app } from './server.js';

const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, '127.0.0.1', () => {
    console.log('Server 🔌 started at port', PORT);
    console.log(`Running at http://localhost:${PORT}`);
});