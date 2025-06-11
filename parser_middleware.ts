import { Request, Response, NextFunction } from 'express';
import {FormDataOptions, FormDataParser} from "./index";

const defaultOptions: FormDataOptions = {
    uploadDir: './storage/temp',
    maxFileSize: 20 * 1024 * 1024, // 20MB
    autoClean: false,
};

const parser = new FormDataParser(defaultOptions);

// Combines both parsing and formatting into one middleware
export const formDataMiddleware = [
    parser.parse(),
    (req: Request, res: Response, next: NextFunction) => {
        req.body = (req as any)._formDataFields || {};
        // @ts-ignore
        req.files = (req as any)._formDataFiles || {};
        next();
    },
    parser.union()
];

// Expose instance for event handling
export { parser as formDataParser };
