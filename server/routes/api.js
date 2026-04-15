const express = require('express');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const archiver = require('archiver');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
const { getDirectoryContents, searchDirectoryRecursive } = require('../utils/fileHandler');

function createApiRouter(getRootDir) {
    const router = express.Router();

    // Middleware to resolve and validate paths
    router.use((req, res, next) => {
        const rootDir = getRootDir();
        if (!rootDir) {
            return res.status(400).json({ error: 'Root directory not configured' });
        }

        // Decode URI component to handle spaces and special characters
        try {
            req.requestedPath = decodeURIComponent(req.path.replace(/^\/(files|stream|download|upload|search|media-info|stream-custom)/, '') || '/');
            req.fullPath = path.normalize(path.join(rootDir, req.requestedPath));

            // Security check against directory traversal
            if (!req.fullPath.startsWith(path.normalize(rootDir))) {
                return res.status(403).json({ error: 'Access denied: Invalid path' });
            }
            next();
        } catch (err) {
            res.status(400).json({ error: 'Invalid path' });
        }
    });

    // Get directory contents or file metadata
    router.get(/^\/files(.*)$/, async (req, res) => {
        try {
            const stats = await fs.promises.stat(req.fullPath);
            if (stats.isDirectory()) {
                const contents = await getDirectoryContents(req.fullPath);
                res.json({
                    path: req.requestedPath === '/' ? '' : req.requestedPath,
                    isDirectory: true,
                    contents
                });
            } else {
                res.json({
                    name: path.basename(req.fullPath),
                    isDirectory: false,
                    size: stats.size,
                    mtime: stats.mtime,
                    mimeType: mime.lookup(req.fullPath) || 'application/octet-stream'
                });
            }
        } catch (error) {
            console.error(error);
            if (error.code === 'ENOENT') {
                res.status(404).json({ error: 'File or directory not found' });
            } else {
                res.status(500).json({ error: 'Internal server error' });
            }
        }
    });

    // Recursive search
    router.get(/^\/search(.*)$/, async (req, res) => {
        try {
            const query = req.query.q || '';
            if (query.trim().length === 0) {
                return res.json({ path: req.requestedPath, isSearch: true, contents: [] });
            }

            const stats = await fs.promises.stat(req.fullPath);
            if (!stats.isDirectory()) {
                return res.status(400).json({ error: 'Search path must be a directory' });
            }

            const searchResults = await searchDirectoryRecursive(req.fullPath, req.fullPath, query);

            res.json({
                path: req.requestedPath === '/' ? '' : req.requestedPath,
                isSearch: true,
                contents: searchResults
            });
        } catch (error) {
            console.error('Search API Error:', error);
            res.status(500).json({ error: 'Failed to execute search' });
        }
    });

    // Probe Media Files for embedded Audio Tracks and Video Resolutions
    router.get(/^\/media-info(.*)$/, async (req, res) => {
        try {
            const filePath = req.fullPath;
            const stats = await fs.promises.stat(filePath);
            if (!stats.isFile()) {
                return res.status(400).json({ error: 'Target must be a file' });
            }

            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) {
                    console.error('FFprobe Error:', err);
                    return res.status(500).json({ error: 'Failed to probe media' });
                }

                const info = {
                    video: [],
                    audio: []
                };

                let audioIndexCounter = 0; // Use a relative counter for user selection

                metadata.streams.forEach(stream => {
                    if (stream.codec_type === 'video') {
                        info.video.push({
                            index: stream.index,
                            width: stream.width,
                            height: stream.height,
                            codec: stream.codec_name
                        });
                    } else if (stream.codec_type === 'audio') {
                        info.audio.push({
                            index: stream.index,
                            customId: audioIndexCounter++, // Provide a mapping ID for frontend selection
                            language: stream.tags ? (stream.tags.language || stream.tags.title || 'Unknown') : 'Unknown',
                            codec: stream.codec_name,
                            channels: stream.channels
                        });
                    }
                });

                res.json(info);
            });
        } catch (error) {
            console.error('API /media-info error:', error);
            res.status(500).json({ error: 'Internal server error while probing media' });
        }
    });

    // Stream media files
    router.get(/^\/stream(.*)$/, (req, res) => {
        const filePath = req.fullPath;
        fs.stat(filePath, (err, stats) => {
            if (err) {
                if (err.code === 'ENOENT') {
                    return res.status(404).send('File not found');
                }
                return res.status(500).send('Error reading file');
            }

            if (stats.isDirectory()) {
                return res.status(400).send('Cannot stream a directory');
            }

            const range = req.headers.range;
            if (!range) {
                // If no range request, send the whole file (or ask for range)
                const mimeType = mime.lookup(filePath) || 'application/octet-stream';
                res.writeHead(200, {
                    'Content-Length': stats.size,
                    'Content-Type': mimeType
                });
                fs.createReadStream(filePath).pipe(res);
                return;
            }

            const positions = range.replace(/bytes=/, "").split("-");
            const start = parseInt(positions[0], 10);
            const total = stats.size;
            const end = positions[1] ? parseInt(positions[1], 10) : total - 1;
            const chunksize = (end - start) + 1;

            const mimeType = mime.lookup(filePath) || 'application/octet-stream';

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${total}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': mimeType
            });

            const stream = fs.createReadStream(filePath, { start, end });
            stream.pipe(res);

            stream.on('error', (streamErr) => {
                console.error(`Stream error for ${filePath}:`, streamErr);
                res.end();
            });
        });
    });



    // Custom FFmpeg Live Transcoding Stream (For mapping Audio tracks or Qualities)
    router.get(/^\/stream-custom(.*)$/, async (req, res) => {
        try {
            const filePath = req.fullPath;
            const stats = await fs.promises.stat(filePath);

            if (!stats.isFile()) {
                return res.status(400).json({ error: 'Target must be a file' });
            }

            // Extract query parameters for audio index and resolution height
            const audioIndex = req.query.audio; // numeric index of the audio stream
            const resHeight = req.query.res; // e.g. 720, 1080
            const startTime = req.query.time; // time in seconds to start streaming from

            let command = ffmpeg(filePath);
            
            // Fast seek input without decoding the entire video (crucial for performance)
            if (startTime && !isNaN(startTime)) {
                command.seekInput(startTime);
            }
            
            // Map the video stream as default
            command.outputOptions(['-map 0:v:0']);

            // If an audio index was provided, explicitly map only that audio stream
            if (audioIndex !== undefined && audioIndex !== null) {
                command.outputOptions([`-map 0:a:${audioIndex}`]);
            } else {
                // Default map first audio
                command.outputOptions(['-map 0:a:0']);
            }

            // Copy video codec to save CPU massively unless downscaling is requested
            if (resHeight) {
                command.videoCodec('libx264')
                       .outputOptions([
                           `-vf scale=-2:${resHeight}`,
                           '-preset ultrafast',
                           '-tune zerolatency'
                       ]);
            } else {
                command.videoCodec('copy');
            }

            // Always encode audio to AAC for universal web compatibility 
            command.audioCodec('aac')
                   .audioBitrate('192k')
                   .outputOptions(['-ac 2']);

            // Critical for streaming live: frag_keyframe + empty_moov + default_base_moof
            command.format('mp4')
                   .outputOptions(['-movflags frag_keyframe+empty_moov+default_base_moof']);

            res.contentType('video/mp4');

            command.on('error', (err, stdout, stderr) => {
                if (err.message && err.message.includes('Output stream closed')) {
                    // Normal behavior when frontend user closes modal or seeks away
                    return;
                }
                console.error('FFmpeg streaming error:', err.message);
                if (!res.headersSent) {
                    res.status(500).end();
                }
            });

            // Pipe direct to Express HTTP Response
            command.pipe(res, { end: true });

            // Ensure ffmpeg process terminates if frontend abruptly closes the modal
            req.on('close', () => {
                command.kill('SIGKILL');
            });

        } catch (error) {
            console.error('Custom stream setup error:', error);
            res.status(500).json({ error: 'Failed to start Live Custom Stream' });
        }
    });
    router.get(/^\/download(.*)$/, (req, res) => {
        const filePath = req.fullPath;
        fs.stat(filePath, (err, stats) => {
            if (err) {
                return res.status(404).send('File not found');
            }

            if (stats.isDirectory()) {
                // Zip directory and send
                const archive = archiver('zip', {
                    zlib: { level: 9 } // Maximum compression
                });

                archive.on('error', function (err) {
                    res.status(500).send({ error: err.message });
                });

                const dirName = path.basename(filePath) || 'archive';
                res.attachment(`${dirName}.zip`);

                archive.pipe(res);
                archive.directory(filePath, false);
                archive.finalize();
            } else {
                // Download single file
                res.download(filePath);
            }
        });
    });

    // Configure Multer for High-Speed Uploads
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            // Because of our middleware, req.fullPath already resolves to the correct directory
            // Ensure the directory actually exists before saving
            fs.stat(req.fullPath, (err, stats) => {
                if (err || !stats.isDirectory()) {
                    console.error('Multer Destination Error - Path:', req.fullPath, 'Err:', err);
                    return cb(new Error(`Upload destination is not a valid directory: ${req.fullPath}`), null);
                }
                cb(null, req.fullPath);
            });
        },
        filename: function (req, file, cb) {
            // Keep the original filename
            // We could add logic here to prevent overwriting if desired, but default to overwrite for now
            cb(null, file.originalname);
        }
    });

    const upload = multer({
        storage: storage,
        limits: { fileSize: 10 * 1024 * 1024 * 1024 } // 10GB limit per file for massive transfers
    });

    // Handle File Uploads (Supports multiple files)
    router.post(/^\/upload(.*)$/, (req, res) => {
        upload.array('files')(req, res, function (err) {
            if (err instanceof multer.MulterError) {
                console.error('Multer Error:', err);
                return res.status(500).json({ error: 'Multer upload error: ' + err.message });
            } else if (err) {
                console.error('Unknown Upload Error:', err);
                return res.status(500).json({ error: 'Unknown upload error: ' + err.message });
            }

            try {
                if (!req.files || req.files.length === 0) {
                    return res.status(400).json({ error: 'No files uploaded' });
                }
                res.json({ success: true, message: `Successfully uploaded ${req.files.length} files.` });
            } catch (error) {
                console.error('Post-Upload Processing Error:', error);
                res.status(500).json({ error: 'Failed to process upload' });
            }
        });
    });

    return router;
}

module.exports = createApiRouter;
