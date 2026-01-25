# express-multipart-parser

A lightweight, robust, and easy-to-use Express middleware for parsing `multipart/form-data` requests. It handles both text fields and file uploads, parsing them into `req.body` and `req.files` respectively.

[![npm version](https://img.shields.io/npm/v/express-multipart-parser.svg)](https://www.npmjs.com/package/express-multipart-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- 🚀 **Zero Dependencies**: (Apart from `express` peer dependency) Built using native Node.js modules.
- 📁 **File Uploads**: Streams files directly to disk (configurable location).
- 📝 **Text Fields**: Parses text fields into `req.body`.
- 🗃️ **Array Support**: Automatically handles array fields (e.g., `items[]`).
- 🧹 **Auto Cleanup**: Option to automatically delete uploaded files after request processing (great for temporary processing).
- 🛡️ **Size Limits**: Configurable max file size limit.
- 🧩 **Flexible API**: Use as a single middleware or compose your own.
- 🦾 **TypeScript Support**: Written in TypeScript with full type definitions included.

## Installation

```bash
npm install express-multipart-parser
```

## Usage

### Basic Usage

The easiest way to use it is with the default `formDataMiddleware`. This will parse the request and populate `req.body` and `req.files`.

```typescript
import express from 'express';
import { formDataMiddleware } from 'express-multipart-parser';

const app = express();

app.post('/upload', formDataMiddleware, (req, res) => {
    console.log('Fields:', req.body);
    console.log('Files:', req.files);
    
    // Example file access
    if (req.files.avatar) {
        console.log('Uploaded file path:', req.files.avatar.path);
    }
    
    res.json({ message: 'Upload successful' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

### Custom Configuration

You can create a custom instance of `FormDataParser` to configure options like upload directory and size limits.

```typescript
import express from 'express';
import { FormDataParser } from 'express-multipart-parser';
import { join } from 'path';

const app = express();

const parser = new FormDataParser({
    uploadDir: join(__dirname, 'uploads'), // Default: os.tmpdir()
    maxFileSize: 5 * 1024 * 1024,          // Default: Infinity (5MB here)
    autoClean: true                        // Default: false (Delete files after request ends? No, this option is for cleanup on error/custom logic)
});

// Use the setup helper to register the middleware chain
import { setupParser } from 'express-multipart-parser';
app.post('/upload', setupParser(parser), (req, res) => {
    // ...
});

// OR manually chain them:
// app.post('/upload', parser.parse(), parser.format(), (req, res, next) => { ... });
```

### Options

| Option | Type | Default | Description |
|ion | Type | Default | Description |
|---|---|---|---|
| `uploadDir` | `string` | `os.tmpdir()` | Directory where uploaded files will be stored. |
| `maxFileSize` | `number` | `Infinity` | Maximum allowed file size in bytes. Request fails if exceeded. |
| `autoClean` | `boolean` | `false` | If `true`, files are automatically deleted if an error occurs during parsing. (Note: You usually want to handle success cleanup yourself or use a temp dir). |

### Request Objects

#### `req.body`
Contains text fields.
```json
{
  "username": "john_doe",
  "hobbies": ["coding", "reading"]
}
```

#### `req.files`
Contains file information. Keys match the form field names.
```json
{
  "avatar": {
    "path": "/path/to/upload/uuid.png",
    "fileName": "profile.png",
    "mimeType": "image/png",
    "size": 12345
  }
}
```
If multiple files are uploaded with the same field name (e.g., `photos[]`), the value will be an array of file objects.

### Advanced: Events

The `FormDataParser` class extends `EventEmitter`. You can listen to events directly if you instantiate it manually (though usually middleware handles this).

- `fileBegin`: Emitted when a file upload starts.
- `file`: Emitted when a file upload is complete.
- `field`: Emitted when a text field is parsed.
- `error`: Emitted on error.
- `end`: Emitted when parsing is complete.

## License

MIT
