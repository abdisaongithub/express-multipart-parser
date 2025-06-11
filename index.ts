// form-data-middleware.ts
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
                            handleFileFinish();
                        }

                        if (part.length === 0) continue;

                        const headerEnd = part.indexOf('\r\n\r\n');
                        if (headerEnd === -1) {
                            // incomplete headers - wait for more data
                            break;
                        }

                        const rawHeaders = part.slice(0, headerEnd).toString('utf-8');
                        const body = part.slice(headerEnd + 4);

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
                                this.emit('error', new Error('File size limit exceeded'));
                                processingFile = null;
                                return;
                            }
                        } else {
                            // text field
                            const value = body.toString('utf-8').replace(/\r?\n$/, '');
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
                            this.emit('error', new Error('File size limit exceeded'));
                            processingFile = null;
                            return;
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


//
// import { Request, Response, NextFunction } from 'express';
// import { mkdirSync, createWriteStream, unlinkSync } from 'fs';
// import { tmpdir } from 'os';
// import { join } from 'path';
// import { randomUUID } from 'crypto';
// import readline from 'readline';
// import { PassThrough } from 'stream';
//
// export interface FormDataOptions {
//     uploadDir?: string;
//     autoClean?: boolean;
//     maxFileSize?: number; // in bytes
// }
//
// interface FileData {
//     path: string;
//     filename: string;
//     mimetype: string;
//     size: number;
// }
//
// const parseContentDisposition = (header: string) => {
//     const match = /name="(.+?)"(?:; filename="(.+?)")?/.exec(header);
//     return match ? { name: match[1], filename: match[2] } : null;
// };
//
// export function parse(options: FormDataOptions = {}) {
//     const uploadDir = options.uploadDir || tmpdir();
//     const autoClean = options.autoClean ?? false;
//     const maxFileSize = options.maxFileSize ?? Infinity;
//
//     mkdirSync(uploadDir, { recursive: true });
//
//     return (req: Request, res: Response, next: NextFunction) => {
//         const contentType = req.headers['content-type'];
//         if (!contentType?.startsWith('multipart/form-data')) {
//             return next();
//         }
//
//         const boundaryMatch = contentType.match(/boundary=(.+)$/);
//         if (!boundaryMatch) return next();
//         const boundary = Buffer.from(`--${boundaryMatch[1]}`);
//
//         const fields: Record<string, string | string[]> = {};
//         const files: Record<string, FileData[] | FileData> = {};
//
//         let buffer = Buffer.alloc(0);
//         let processingFile: {
//             name: string;
//             filename: string;
//             mimetype: string;
//             size: number;
//             path: string;
//             stream: ReturnType<typeof createWriteStream>;
//         } | null = null;
//
//         // Helper: parse headers block into object
//         const parseHeaders = (headerText: string) => {
//             const headers: Record<string, string> = {};
//             const lines = headerText.split('\r\n');
//             for (const line of lines) {
//                 const idx = line.indexOf(':');
//                 if (idx !== -1) {
//                     const key = line.slice(0, idx).trim().toLowerCase();
//                     const val = line.slice(idx + 1).trim();
//                     headers[key] = val;
//                 }
//             }
//             return headers;
//         };
//
//         req.on('data', (chunk: Buffer) => {
//             buffer = Buffer.concat([buffer, chunk]);
//
//             while (true) {
//                 // Find boundary
//                 const boundaryIndex = buffer.indexOf(boundary);
//                 if (boundaryIndex === -1) break;
//
//                 // Extract part up to boundary
//                 const part = buffer.slice(0, boundaryIndex);
//                 buffer = buffer.slice(boundaryIndex + boundary.length + 2); // Skip boundary + CRLF
//
//                 if (processingFile) {
//                     // Close previous file stream
//                     processingFile.stream.end();
//                     const fileMeta: FileData = {
//                         path: processingFile.path,
//                         filename: processingFile.filename,
//                         mimetype: processingFile.mimetype,
//                         size: processingFile.size,
//                     };
//                     if (processingFile.name.endsWith('[]')) {
//                         const key = processingFile.name.slice(0, -2);
//                         files[key] = Array.isArray(files[key]) ? [...(files[key] as FileData[]), fileMeta] : [fileMeta];
//                     } else {
//                         files[processingFile.name] = fileMeta;
//                     }
//                     processingFile = null;
//                 }
//
//                 if (part.length === 0) continue; // skip empty part (might happen at start)
//
//                 // Split headers and body
//                 const headerEnd = part.indexOf('\r\n\r\n');
//                 if (headerEnd === -1) continue; // incomplete headers, wait for more data
//
//                 const rawHeaders = part.slice(0, headerEnd).toString('utf-8');
//                 const body = part.slice(headerEnd + 4);
//
//                 const headers = parseHeaders(rawHeaders);
//                 const contentDisposition = headers['content-disposition'];
//                 if (!contentDisposition) continue;
//
//                 // Extract name and filename
//                 const nameMatch = contentDisposition.match(/name="([^"]+)"/);
//                 const filenameMatch = contentDisposition.match(/filename="([^"]*)"/);
//
//                 if (!nameMatch) continue;
//                 const fieldName = nameMatch[1];
//
//                 if (filenameMatch && filenameMatch[1]) {
//                     // It's a file part
//                     const filename = filenameMatch[1];
//                     const mimetype = headers['content-type'] || 'application/octet-stream';
//                     const ext = filename.includes('.') ? '.' + filename.split('.').pop() : '';
//                     const filepath = join(uploadDir, randomUUID() + ext);
//                     const stream = createWriteStream(filepath);
//                     stream.write(body);
//                     processingFile = {
//                         name: fieldName,
//                         filename,
//                         mimetype,
//                         size: body.length,
//                         path: filepath,
//                         stream,
//                     };
//                 } else {
//                     // It's a field
//                     const value = body.toString('utf-8').replace(/\r?\n$/, '');
//                     if (fieldName.endsWith('[]')) {
//                         const key = fieldName.slice(0, -2);
//                         fields[key] = Array.isArray(fields[key]) ? [...(fields[key] as string[]), value] : [value];
//                     } else {
//                         fields[fieldName] = value;
//                     }
//                 }
//             }
//
//             // If currently processing a file, write remaining buffer data to its stream
//             if (processingFile && buffer.length > 0) {
//                 processingFile.stream.write(buffer);
//                 processingFile.size += buffer.length;
//
//                 if (processingFile.size > maxFileSize) {
//                     processingFile.stream.end();
//                     if (autoClean) {
//                         try {
//                             unlinkSync(processingFile.path);
//                         } catch {}
//                     }
//                     processingFile = null;
//                 }
//                 buffer = Buffer.alloc(0);
//             }
//         });
//
//         req.on('end', () => {
//             // Close any open file stream at end
//             if (processingFile) {
//                 processingFile.stream.end();
//                 const fileMeta: FileData = {
//                     path: processingFile.path,
//                     filename: processingFile.filename,
//                     mimetype: processingFile.mimetype,
//                     size: processingFile.size,
//                 };
//                 if (processingFile.name.endsWith('[]')) {
//                     const key = processingFile.name.slice(0, -2);
//                     files[key] = Array.isArray(files[key]) ? [...(files[key] as FileData[]), fileMeta] : [fileMeta];
//                 } else {
//                     files[processingFile.name] = fileMeta;
//                 }
//             }
//
//             (req as any)._formDataFields = fields;
//             (req as any)._formDataFiles = files;
//             next();
//         });
//     };
// }
//
// export function format() {
//     return (req: Request, res: Response, next: NextFunction) => {
//         req.body = (req as any)._formDataFields || {};
//         // @ts-ignore
//         req.files = (req as any)._formDataFiles || {};
//         next();
//     };
// }
//
// export function union() {
//     return (req: Request, res: Response, next: NextFunction) => {
//         req.body = {
//             ...((req as any)._formDataFields || {}),
//             ...((req as any)._formDataFiles || {}),
//         };
//         next();
//     };
// }
