
import request from 'supertest';
import express, { Request, Response } from 'express';
import { FormDataParser } from '../index';
import { join } from 'path';
import { existsSync, unlinkSync, rmdirSync, readFileSync } from 'fs';
import assert from 'assert';

const uploadDir = join(__dirname, 'uploads');

describe('FormDataParser Middleware', () => {
    let app: express.Application;
    let parser: FormDataParser;

    beforeEach(() => {
        app = express();
        parser = new FormDataParser({ uploadDir, autoClean: true }); // Enable autoClean for tests
        parser.on('error', (err) => {
            // Suppress unhandled error crashes during tests
        });
        
        // Setup routes for different middleware configurations
        app.post('/parse-only', parser.parse(), (req: Request, res: Response) => {
            res.json({ 
                fields: (req as any)._formDataFields, 
                files: (req as any)._formDataFiles 
            });
        });

        app.post('/format', parser.parse(), parser.format(), (req: Request, res: Response) => {
            res.json({ body: req.body, files: (req as any).files });
        });

        app.post('/union', parser.parse(), parser.union(), (req: Request, res: Response) => {
            res.json(req.body);
        });

        // Custom error handling for size limit tests
        app.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
            res.status(500).json({ error: err.message });
        });
    });

    afterEach(() => {
        // Cleanup is handled by autoClean in most cases, but we can do extra checks if needed
    });

    it('should parse simple text fields', async () => {
        const response = await request(app)
            .post('/parse-only')
            .field('username', 'john_doe')
            .field('email', 'john@example.com')
            .expect(200);

        assert.strictEqual(response.body.fields.username, 'john_doe');
        assert.strictEqual(response.body.fields.email, 'john@example.com');
    });

    it('should parse file uploads', async () => {
        const response = await request(app)
            .post('/parse-only')
            .attach('avatar', Buffer.from('fake image content'), 'avatar.png')
            .expect(200);

        const file = response.body.files.avatar;
        assert.ok(file);
        assert.strictEqual(file.fileName, 'avatar.png');
        assert.strictEqual(file.size, 18); // 'fake image content'.length
        
        // Verify file exists (autoClean is false by default in class, but we set true in beforeEach? 
        // Wait, if autoClean is true, it might delete after request ends? 
        // The implementation says: cleanUpFile is called on error. 
        // It does NOT auto-delete on success unless we implement that logic or the user handles it. 
        // Let's check implementation again.
        // Implementation: cleanUpFile is called in error cases. 
        // It doesn't seem to have a mechanism to auto-clean on success response finish.
        // So the file should still be there.
        
        assert.ok(existsSync(file.path));
        
        // Clean up manually for this test
        try { unlinkSync(file.path); } catch (e) {}
    });

    it('should handle array fields', async () => {
        const response = await request(app)
            .post('/parse-only')
            .field('items[]', 'item1')
            .field('items[]', 'item2')
            .expect(200);

        assert.deepStrictEqual(response.body.fields.items, ['item1', 'item2']);
    });

    it('should correctly format req.body and req.files', async () => {
        const response = await request(app)
            .post('/format')
            .field('name', 'test')
            .attach('doc', Buffer.from('content'), 'test.txt')
            .expect(200);

        assert.strictEqual(response.body.body.name, 'test');
        assert.strictEqual(response.body.files.doc.fileName, 'test.txt');
        
        try { unlinkSync(response.body.files.doc.path); } catch (e) {}
    });

    it('should merge fields and files in union mode', async () => {
        const response = await request(app)
            .post('/union')
            .field('title', 'Report')
            .attach('attachment', Buffer.from('data'), 'data.csv')
            .expect(200);

        assert.strictEqual(response.body.title, 'Report');
        assert.strictEqual(response.body.attachment.fileName, 'data.csv');
        
         try { unlinkSync(response.body.attachment.path); } catch (e) {}
    });

    it('should enforce maxFileSize limit', async () => {
        const smallParser = new FormDataParser({ 
            uploadDir, 
            maxFileSize: 10 // Very small limit
        });
        smallParser.on('error', () => {}); // Handle error to prevent crash
        
        const appWithLimit = express();
        appWithLimit.post('/', smallParser.parse(), (req, res) => res.send('ok'));
        appWithLimit.use((err: any, req: Request, res: Response, next: express.NextFunction) => {
            res.status(413).json({ error: err.message });
        });

        await request(appWithLimit)
            .post('/')
            .attach('file', Buffer.from('this is too long for the limit'), 'large.txt')
            .expect(413);
    });
});
