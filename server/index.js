const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const ip = require('ip');
const os = require('os');
const compression = require('compression');
const createApiRouter = require('./routes/api');

const app = express();
const PORT = 3001;
const CONFIG_PATH = path.join(__dirname, 'config.json');

app.use(cors());
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to read config
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

// Helper to save config
function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// API to get current config
app.get('/api/config', (req, res) => {
    res.json(readConfig());
});

// Check command line arguments for directory
const args = process.argv.slice(2);
if (args.length > 0) {
    const cliDir = args[0].replace(/^"|"$/g, ''); // Remove quotes if any
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

// API to set root directory
app.post('/api/config', (req, res) => {
    const { rootDir } = req.body;
    if (!rootDir) {
        return res.status(400).json({ error: 'Root directory is required' });
    }

    // Check if directory exists
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

// Get configured root dir
function getRootDir() {
    return readConfig().rootDir;
}

// Mount the API router
app.use('/api', createApiRouter(getRootDir));

// Endpoint to get active server connections (HITS)
app.get('/api/stats', (req, res) => {
    // We count active connections to the server
    server.getConnections((err, count) => {
        if (err) {
            return res.json({ connections: 1 }); // fallback
        }
        res.json({ connections: count });
    });
});

// Serve index.html for all GET requests to support SPA
app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        next();
    }
});

// Start the server
const server = app.listen(PORT, '0.0.0.0', () => {
    const config = readConfig();
    
    // Get all valid IPv4 addresses
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
    console.log(`🚀 Server Running:`);
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
    
    // Automatically open the browser for the host user
    try {
        const { exec } = require('child_process');
        exec(`start http://localhost:${PORT}`);
    } catch(err) {}
});
