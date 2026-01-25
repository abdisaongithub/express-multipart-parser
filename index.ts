import {NextFunction, Request, Response} from 'express';
import {createWriteStream, mkdirSync, unlinkSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {randomUUID} from 'crypto';
import EventEmitter from 'events';

export interface FormDataOptions {
    uploadDir?: string;
    autoClean?: boolean;
    maxFileSize?: number; // bytes
}

interface FileInfo {
    path: string;
    fileName: string;
    mimeType: string;
    size: number;
}

export class FormDataParser extends EventEmitter {
    private readonly uploadDir: string;
    private readonly autoClean: boolean;
    private readonly maxFileSize: number;

    constructor(options: FormDataOptions = {}) {
        super();
        this.uploadDir = options.uploadDir || tmpdir();
        this.autoClean = options.autoClean ?? false;
        this.maxFileSize = options.maxFileSize ?? Infinity;
        mkdirSync(this.uploadDir, {recursive: true});
    }

    parse() {
        return (req: Request, res: Response, next: NextFunction) => {
            if (req.method === 'GET' || req.method === 'OPTIONS') {
                return next();
            }

            const contentType = req.headers['content-type'];
            if (!contentType?.startsWith('multipart/form-data')) {
                return next();
            }

            const boundaryMatch = contentType.match(/boundary=(.+)$/);
            if (!boundaryMatch) return next();

            const boundary = Buffer.from(`--${boundaryMatch[1]}`);
            const fields: Record<string, string | string[]> = {};
            const files: Record<string, FileInfo[] | FileInfo> = {};

            let buffer = Buffer.alloc(0);
            let processingFile: {
                name: string;
                filename: string;
                mimetype: string;
                size: number;
                path: string;
                stream: ReturnType<typeof createWriteStream>;
            } | null = null;

            const parseHeaders = (headerText: string) => {
                const headers: Record<string, string> = {};
                const lines = headerText.split('\r\n');
                for (const line of lines) {
                    const idx = line.indexOf(':');
                    if (idx !== -1) {
                        const key = line.slice(0, idx).trim().toLowerCase();
                        const val = line.slice(idx + 1).trim();
                        headers[key] = val;
                    }
                }
                return headers;
            };

            const cleanUpFile = (file: typeof processingFile) => {
                try {
                    if (file) {
                        file.stream.destroy();
                        if (this.autoClean) {
                            unlinkSync(file.path);
                        }
                    }
                } catch (err) {
                    // ignore
                }
            };

            const handleFileFinish = () => {
                if (!processingFile) return;
                processingFile.stream.end();
                const meta: FileInfo = {
                    path: processingFile.path,
                    fileName: processingFile.filename,
                    mimeType: processingFile.mimetype,
                    size: processingFile.size,
                };
                if (processingFile.name.endsWith('[]')) {
                    const key = processingFile.name.slice(0, -2);
                    files[key] = Array.isArray(files[key]) ? [...(files[key] as FileInfo[]), meta] : [meta];
                } else {
                    files[processingFile.name] = meta;
                }
                this.emit('file', meta);
                processingFile = null;
            };

            req.on('data', (chunk: Buffer) => {
                buffer = Buffer.concat([buffer, chunk]);

                try {
                    while (true) {
                        const boundaryIndex = buffer.indexOf(boundary);
                        if (boundaryIndex === -1) break;

                        const part = buffer.slice(0, boundaryIndex);
                        buffer = buffer.slice(boundaryIndex + boundary.length + 2); // skip boundary + CRLF

                        if (processingFile) {
                            // We found the closing boundary for the current file
                            // Write the final part (remove trailing \r\n if present)
                            const endPart = part.length >= 2 ? part.slice(0, part.length - 2) : part;
                            processingFile.stream.write(endPart);
                            processingFile.size += endPart.length;
                            
                            if (processingFile.size > this.maxFileSize) {
                                cleanUpFile(processingFile);
                                const err = new Error('File size limit exceeded');
                                this.emit('error', err);
                                processingFile = null;
                                return next(err);
                            }

                            handleFileFinish();
                            continue;
                        }

                        if (part.length === 0) continue;

                        const headerEnd = part.indexOf('\r\n\r\n');
                        if (headerEnd === -1) {
                            // incomplete headers - wait for more data... 
                            // BUT wait, we found a boundary AFTER this.
                            // So this IS a complete part, but it has no header separator.
                            // This implies malformed data or just not a file part we understand.
                            // Or maybe it's preamble.
                            continue;
                        }

                        const rawHeaders = part.slice(0, headerEnd).toString('utf-8');
                        // The body is everything after headers until the end of `part`.
                        // Since `part` ends at a boundary, we must strip the trailing \r\n (CRLF) that precedes the boundary.
                        const body = part.slice(headerEnd + 4, part.length >= 2 ? part.length - 2 : part.length);

                        const headers = parseHeaders(rawHeaders);
                        const contentDisposition = headers['content-disposition'];
                        if (!contentDisposition) continue;

                        const nameMatch = contentDisposition.match(/name="([^"]+)"/);
                        const filenameMatch = contentDisposition.match(/filename="([^"]*)"/);

                        if (!nameMatch) continue;
                        const fieldName = nameMatch[1];

                        if (filenameMatch && filenameMatch[1]) {
                            // file part
                            const filename = filenameMatch[1];
                            const mimetype = headers['content-type'] || 'application/octet-stream';
                            const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
                            const filepath = join(this.uploadDir, randomUUID() + ext);
                            const stream = createWriteStream(filepath);

                            processingFile = {
                                name: fieldName,
                                filename,
                                mimetype,
                                size: 0,
                                path: filepath,
                                stream,
                            };

                            this.emit('fileBegin', {name: fieldName, filename, mimetype, path: filepath});

                            stream.write(body);
                            processingFile.size += body.length;
                            if (processingFile.size > this.maxFileSize) {
                                cleanUpFile(processingFile);
                                const err = new Error('File size limit exceeded');
                                this.emit('error', err);
                                processingFile = null;
                                return next(err);
                            }
                            
                            // Since `part` is bounded, the file is finished.
                            handleFileFinish();

                        } else {
                            // text field
                            const value = body.toString('utf-8'); // .replace(/\r?\n$/, ''); // Text fields also have \r\n before boundary, but we already stripped it via `body` slice
                            // Actually, let's verify if `body` slice handles it correctly.
                            // If `body` is sliced - 2, we removed the implicit CRLF.
                            
                            if (fieldName.endsWith('[]')) {
                                const key = fieldName.slice(0, -2);
                                fields[key] = Array.isArray(fields[key]) ? [...(fields[key] as string[]), value] : [value];
                            } else {
                                fields[fieldName] = value;
                            }
                            this.emit('field', {name: fieldName, value});
                        }
                    }

                    if (processingFile && buffer.length > 0) {
                        processingFile.stream.write(buffer);
                        processingFile.size += buffer.length;

                        if (processingFile.size > this.maxFileSize) {
                            cleanUpFile(processingFile);
                            const err = new Error('File size limit exceeded');
                            this.emit('error', err);
                            processingFile = null;
                            return next(err);
                        }
                        buffer = Buffer.alloc(0);
                    }
                } catch (err) {
                    this.emit('error', err as Error);
                    return next(err);
                }
            });

            req.on('end', () => {
                try {
                    if (processingFile) {
                        handleFileFinish();
                    }

                    (req as any)._formDataFields = fields;
                    (req as any)._formDataFiles = files;
                    this.emit('end', {fields, files});
                    next();
                } catch (err) {
                    this.emit('error', err as Error);
                    next(err);
                }
            });

            req.on('error', (err) => {
                this.emit('error', err);
                next(err);
            });
        };
    }

    format() {
        return (req: Request, res: Response, next: NextFunction) => {
            req.body = (req as any)._formDataFields || {};
            // @ts-ignore
            req.files = (req as any)._formDataFiles || {};
            next();
        };
    }

    union() {
        return (req: Request, res: Response, next: NextFunction) => {
            req.body = {
                ...((req as any)._formDataFields || {}),
                ...((req as any)._formDataFiles || {}),
            };
            next();
        };
    }
}

export const setupParser = (parser: FormDataParser) => {
    return [
        parser.parse(),
        parser.format(),
        parser.union()
    ]
}

const defaultOptions: FormDataOptions = {
    // uploadDir: os.tmpdir(), // Let class default handle it
    maxFileSize: 20 * 1024 * 1024, // 20MB default for the pre-built middleware
    autoClean: false,
};

// Create a default instance
export const formDataParser = new FormDataParser(defaultOptions);

// Combines both parsing and formatting into one middleware
export const formDataMiddleware = [
    formDataParser.parse(),
    formDataParser.format(), // Use the class method instead of inline function
    formDataParser.union()
];
