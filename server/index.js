const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ip = require('ip');
const os = require('os');
const compression = require('compression');
const createApiRouter = require('./routes/api');
const { VERSION } = require('./routes/api');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.json');

function readConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('Error reading config:', error);
    }
    return { rootDir: "" };
}

function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// Port: config.json port, then env PORT, default 3001.
const configAtBoot = readConfig();
const PORT = Number(process.env.PORT || configAtBoot.port || 3001) || 3001;

// Never die silently: log crashes instead of flashing a stack trace
// and closing the window before anyone can read it.
process.on('uncaughtException', (err) => {
    console.error('\n[Error] Server crashed:', err && err.message ? err.message : err);
    if (err && err.stack) console.error(err.stack);
    console.error('[Error] Fix the problem above, then run Start-Server.bat again.\n');
    process.exit(1);
});
process.on('unhandledRejection', (err) => {
    console.error('\n[Error] Unhandled error:', err && err.message ? err.message : err);
});

let server = null;
const getServer = () => server;

app.use(cors());
app.use(compression());
app.use(express.json());
// Security headers (v2.0)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
    res.json(readConfig());
});

const args = process.argv.slice(2);
if (args.length > 0) {
    const cliDir = args[0].replace(/^"|"$/g, '');
    try {
        if (fs.statSync(cliDir).isDirectory()) {
            const config = readConfig();
            config.rootDir = cliDir;
            saveConfig(config);
            console.log(`[Config] Updated root directory from command line to: ${cliDir}`);
        } else {
            console.error(`[Error] Path provided via command line is not a directory: ${cliDir}`);
        }
    } catch (err) {
        console.error(`[Error] Directory provided via command line does not exist: ${cliDir}`);
    }
}

app.post('/api/config', (req, res) => {
    const { rootDir } = req.body;
    if (!rootDir) {
        return res.status(400).json({ error: 'Root directory is required' });
    }
    try {
        const stats = fs.statSync(rootDir);
        if (!stats.isDirectory()) {
            return res.status(400).json({ error: 'Path is not a directory' });
        }
    } catch (err) {
        return res.status(400).json({ error: 'Directory does not exist' });
    }
    const config = readConfig();
    config.rootDir = rootDir;
    saveConfig(config);
    res.json({ success: true, config });
});

function getRootDir() {
    return readConfig().rootDir;
}

app.use('/api', createApiRouter(getRootDir, { getPort: () => PORT, getServer }));

app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        next();
    }
});

// Banner is delayed 500ms and cancelled on error, so a failed start
// (e.g. port in use) never prints a misleading "Server Running" first.
let bannerTimer = null;
function printBanner() {
    const config = readConfig();
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const k in interfaces) {
        for (const k2 in interfaces[k]) {
            const address = interfaces[k][k2];
            if (address.family === 'IPv4' && !address.internal) {
                addresses.push(address.address);
            }
        }
    }

    console.log(`\n================================`);
    console.log(`🚀 Server Running (v${VERSION}):`);
    console.log(`Local: http://localhost:${PORT}`);
    if (addresses.length > 0) {
        addresses.forEach(addr => {
            console.log(`LAN:   http://${addr}:${PORT}`);
        });
    } else {
        console.log(`LAN:   http://${ip.address()}:${PORT}`);
    }
    console.log(`Root Directory: ${config.rootDir || 'Not configured yet. Visit UI to setup.'}`);
    console.log(`Mode: LAN Only`);
    console.log(`================================\n`);

    try {
        const { exec } = require('child_process');
        exec(`start http://localhost:${PORT}`);
    } catch(err) {}
}

server = app.listen(PORT, '0.0.0.0', () => {
    bannerTimer = setTimeout(() => {
        if (server.listening) printBanner();
    }, 500);
});

// Friendly error if the port is already taken (e.g. an old Speed
// server is still running in the background) — previously this
// threw an uncaught EADDRINUSE and the window closed instantly.
server.on('error', (err) => {
    if (bannerTimer) clearTimeout(bannerTimer);
    if (err && err.code === 'EADDRINUSE') {
        console.error(`\n[Error] Port ${PORT} is already in use.`);
        console.error('[Error] Another Speed server (or another app) is already running on this port.');
        console.error('[Error] Close the old server window / stop the old node.exe in Task Manager,');
        console.error('[Error] or change "port" in server/config.json, then run Start-Server.bat again.\n');
    } else {
        console.error('\n[Error] Failed to start server:', err && err.message ? err.message : err);
        if (err && err.stack) console.error(err.stack);
    }
    process.exit(1);
});
