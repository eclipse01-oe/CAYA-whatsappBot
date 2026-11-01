import 'dotenv/config';
import express, {type Application, type Request, type Response} from 'express'
import cors from 'cors';
import { whatsappRouter } from './routes/routes.js'

export const app: Application = express()


const urlOrigin = process.env.urlOrigin

app.use(cors({
    origin: urlOrigin,
}))

app.use(express.json())
app.use(whatsappRouter)

app.get('/', (_req: Request, res: Response) =>{
    res.json({
        message: 'connected to caya whatsapp backend bot'
    })
})
