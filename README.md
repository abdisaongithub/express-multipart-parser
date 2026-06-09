# express-multipart-parser

A lightweight, robust, and easy-to-use Express middleware for parsing `multipart/form-data` requests. It handles both text fields and file uploads, parsing them into `req.body` and `req.files`.

[![npm version](https://img.shields.io/npm/v/express-multipart-parser.svg)](https://www.npmjs.com/package/express-multipart-parser)
[![npm downloads](https://img.shields.io/npm/dm/express-multipart-parser.svg)](https://www.npmjs.com/package/express-multipart-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Dependency Audit](https://github.com/abdisaongithub/express-multipart-parser/actions/workflows/dependency-audit.yml/badge.svg)](https://github.com/abdisaongithub/express-multipart-parser/actions/workflows/dependency-audit.yml)

## Features

- 🚀 **Zero Dependencies**: (Apart from `express` peer dependency) Built using native Node.js modules.
- 📁 **File Uploads**: Streams files directly to disk (configurable location).
- 📝 **Text Fields**: Parses text fields into `req.body`.
- 🗃️ **Array Support**: Automatically handles array fields (e.g., `items[]`).
- 🔗 **Union Mode**: Merges uploaded files into `req.body` for unified access (enabled by default).
- 🧹 **Auto Cleanup**: Option to automatically delete uploaded files on error (configurable).
- 🛡️ **Size Limits**: Configurable max file size limit.
- 🧩 **Flexible API**: Use as a single middleware or compose your own chain.
- 🦾 **TypeScript Support**: Written in TypeScript with full type definitions included.

## Installation

```bash
npm install express-multipart-parser
```

## Usage

### Quick Start

The easiest way to use it is with the default `formDataMiddleware`. This will parse the request and populate `req.body` (with both fields and files) and `req.files` (files only).

```typescript
import express from 'express';
import { formDataMiddleware } from 'express-multipart-parser';

const app = express();

// Apply middleware
app.post('/upload', formDataMiddleware, (req, res) => {
    // req.body contains text fields AND file objects (merged)
    console.log('Username:', req.body.username);
    console.log('Avatar File Info:', req.body.avatar); 

    // req.files strictly contains only file objects
    console.log('Avatar (from files):', req.files.avatar);
    
    res.json({ message: 'Upload successful' });
});

app.listen(3000, () => console.log('Server running on port 3000'));
```

### Custom Configuration

You can create a custom instance of `FormDataParser` to configure options like upload directory and size limits, and then use `setupParser` to apply it.

```typescript
import express from 'express';
import { FormDataParser, setupParser } from 'express-multipart-parser';
import { join } from 'path';

const app = express();

const parser = new FormDataParser({
    uploadDir: join(__dirname, 'uploads'), // Default: os.tmpdir()
    maxFileSize: 5 * 1024 * 1024,          // Default: Infinity (5MB here)
    autoClean: true                        // Default: false
});

// Use setupParser to apply the standard middleware chain (Parser -> Format -> Union)
app.post('/upload', setupParser(parser), (req, res) => {
    // ... logic
});
```

### Modular Usage (Advanced)

If you don't want the default behavior (e.g., you don't want files merged into `req.body`), you can chain the middleware methods manually.

```typescript
// Only parse and format (req.body = fields, req.files = files)
app.post('/separate', parser.parse(), parser.format(), (req, res) => {
    // req.body has fields
    // req.files has files
    // req.body DOES NOT contain files
});

// Only parse (raw data available in internal properties, usually you want format())
app.post('/raw', parser.parse(), (req, res) => {
    // Access internal storage if really needed
});
```

## API Reference

### `FormDataOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `uploadDir` | `string` | `os.tmpdir()` | Directory where uploaded files will be stored. |
| `maxFileSize` | `number` | `Infinity` | Maximum allowed file size in bytes. Request fails if exceeded. |
| `autoClean` | `boolean` | `false` | If `true`, files are automatically deleted if an error occurs during parsing. |

### `FormDataParser` Methods

- **`parse()`**: Main middleware that processes the multipart stream, handles file writing, and parses text fields.
- **`format()`**: Middleware that exposes the parsed data on `req.body` and `req.files`.
- **`union()`**: Middleware that merges `req.files` properties into `req.body`.

## Events

The `FormDataParser` class extends `EventEmitter`. You can listen to events directly if you instantiate it manually.

- `fileBegin`: Emitted when a file upload starts.
- `file`: Emitted when a file upload is complete.
- `field`: Emitted when a text field is parsed.
- `error`: Emitted on error (e.g. file size exceeded).
- `end`: Emitted when parsing is complete.

## License

MIT

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Watch mode
npm run test:watch

# Build
npm run build
```

## CI/CD

This project uses GitHub Actions for continuous integration:

- **Pre-commit hook**: Runs tests and `npm audit --audit-level=high` before every commit (via Husky).
- **Dependency Audit**: Runs on every PR and weekly (Monday 8am UTC). Creates a GitHub Issue if vulnerabilities are found.
- **Publish**: Automatically publishes to npm on push to `main` when the version in `package.json` is bumped.
