import express, {Request, Response, Application} from 'express';
import {setupParser, FormDataOptions, FormDataParser} from './index';

const app: Application = express();

const defaultOptions: FormDataOptions = {
    uploadDir: './storage/temp',
    maxFileSize: 20 * 1024 * 1024, // 20MB
    autoClean: false,
};

const parser = new FormDataParser(defaultOptions);

app.use(setupParser(parser))


app.post('/upload', (req: Request, res: Response) => {
    console.log('post route /upload')
    console.log('req.body: ', req.body)
    // @ts-ignore
    console.log('req.files: ', req.files)
    // @ts-ignore
    res.json({body: req.body, files: req.files});
    // return;
});

app.listen(4000, '127.0.0.1', () => console.log('Server running on port 4000'));
