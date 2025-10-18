import { ScryptedDeviceBase, Camera, VideoCamera, MediaObject, RequestMediaStreamOptions, ScryptedMimeTypes, ScryptedDeviceType, Settings, Setting } from '@scrypted/sdk';
import { OwletAuth, TUTKCredentials } from './owlet-auth';
import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface OwletDeviceData {
    deviceId: string;
    name: string;
    type: string;
    deviceType: string;
    status: string;
    serialNumber?: string;
    firmwareVersion?: string;
    ipAddress?: string;
    port?: number;
    uid?: string;
    password?: string;
}

export interface StreamQuality {
    id: string;
    name: string;
    width: number;
    height: number;
    bitrate: number;
    fps: number;
}

export interface ConnectionPool {
    process: ChildProcess | null;
    streamUrl: string | null;
    quality: string;
    lastUsed: number;
    isActive: boolean;
    reconnectAttempts: number;
}

export class OwletCamera extends ScryptedDeviceBase implements Camera, VideoCamera, Settings {
    deviceData: OwletDeviceData;
    auth: OwletAuth;
    isStreaming: boolean = false;
    name: string;
    nativeId: string;
    type: ScryptedDeviceType;
    interfaces: string[];
    
    // TUTK credentials
    tutkCredentials: TUTKCredentials | null = null;
    
    // Connection pooling
    connectionPool: Map<string, ConnectionPool> = new Map();
    activeConnections: number = 0;
    maxConnections: number = 3;
    
    // Stream management
    currentQuality: string = 'HD';
    streamTimeout: number = 300; // 5 minutes
    motionDetection: boolean = true;
    
    // Error recovery
    reconnectDelay: number = 1000; // Start with 1 second
    maxReconnectAttempts: number = 5;
    lastReconnectTime: number = 0;

    constructor(nativeId: string, deviceData: OwletDeviceData, auth: OwletAuth) {
        super(nativeId);
        this.deviceData = deviceData;
        this.auth = auth;
        this.name = deviceData.name;
        this.nativeId = nativeId;
        this.type = ScryptedDeviceType.Camera;
        this.interfaces = ['Camera', 'VideoCamera', 'Settings'];
        this.updateDeviceData(deviceData);
        this.loadTUTKCredentials();
        this.initializeConnectionManagement();
    }

    updateDeviceData(deviceData: OwletDeviceData): void {
        this.deviceData = deviceData;
        this.name = deviceData.name;
        this.console.log(`Updated device data for ${deviceData.name}`);
    }

    async loadTUTKCredentials(): Promise<void> {
        try {
            this.console.log(`Loading TUTK credentials for camera ${this.deviceData.name} (${this.deviceData.deviceId})`);
            
            // Ensure we have a valid token
            const jwt = await this.auth.ensureValidToken();
            if (!jwt) {
                this.console.error('No valid JWT token available for TUTK credentials');
                throw new Error('Authentication required. Please check your Owlet credentials.');
            }

            this.tutkCredentials = await this.auth.getTUTKCredentials(jwt, this.deviceData.deviceId);
            this.console.log(`Successfully loaded TUTK credentials for ${this.deviceData.name} (TUTK ID: ${this.tutkCredentials.tutkid})`);
        } catch (error: any) {
            this.console.error(`Failed to load TUTK credentials for ${this.deviceData.name}: ${error.message}`);
            
            // Handle specific error cases
            if (error.message.includes('Camera') && error.message.includes('not found')) {
                throw new Error(`Camera ${this.deviceData.name} is offline or not accessible. Please check the camera's power and network connection.`);
            }
            
            if (error.message.includes('Authentication expired')) {
                throw new Error('Authentication expired. Please check your Owlet credentials.');
            }
            
            if (error.message.includes('Network error')) {
                throw new Error('Network error: Unable to connect to Owlet servers. Please check your internet connection.');
            }
            
            throw error;
        }
    }

    async getVideoStream(options?: RequestMediaStreamOptions): Promise<MediaObject> {
        try {
            const quality = options?.id || this.currentQuality;
            this.console.log(`Starting video stream for ${this.deviceData.name} at ${quality} quality`);
            
            // Ensure TUTK credentials are loaded
            if (!this.tutkCredentials) {
                await this.loadTUTKCredentials();
                if (!this.tutkCredentials) {
                    throw new Error('Failed to load TUTK credentials');
                }
            }

            // Try Python TUTK wrapper first
            try {
                const pythonStream = await this.getPythonTUTKStream(options);
                if (pythonStream) {
                    this.console.log('Using Python TUTK stream');
                    return pythonStream;
                }
            } catch (error: any) {
                this.console.log('Python TUTK stream failed, falling back to native implementation:', error.message);
            }

            // Fall back to native TUTK implementation
            // Check connection pool for existing connection
            let connection = this.connectionPool.get(quality);
            
            if (!connection || !connection.isActive) {
                // Create new connection
                connection = await this.createTUTKConnection(quality);
                this.connectionPool.set(quality, connection);
            }

            // Update last used time
            connection.lastUsed = Date.now();
            this.activeConnections++;
            this.isStreaming = true;
            
            this.console.log(`Active connections: ${this.activeConnections}/${this.maxConnections}`);
            
            return this.createMediaObject(connection.streamUrl!, ScryptedMimeTypes.Url);

        } catch (error: any) {
            this.console.error(`Error starting video stream for ${this.deviceData.name}: ${error.message}`);
            
            // Handle specific error cases
            if (error.message.includes('Camera') && error.message.includes('offline')) {
                throw new Error(`Camera ${this.deviceData.name} is offline. Please check the camera's power and network connection.`);
            }
            
            if (error.message.includes('Authentication expired')) {
                throw new Error('Authentication expired. Please check your Owlet credentials.');
            }
            
            if (error.message.includes('Network error')) {
                throw new Error('Network error: Unable to connect to camera. Please check your internet connection.');
            }
            
            if (error.message.includes('TUTK credentials not available')) {
                throw new Error('Camera streaming credentials not available. Please try again in a few moments.');
            }
            
            await this.handleStreamError(error, options?.id || this.currentQuality);
            throw error;
        }
    }

    async createTUTKConnection(quality: string): Promise<ConnectionPool> {
        if (!this.tutkCredentials) {
            throw new Error('TUTK credentials not available');
        }

        const { tutkid, password, authKey } = this.tutkCredentials;
        
        // Create a temporary file for the stream
        const tempDir = os.tmpdir();
        const streamFile = path.join(tempDir, `owlet_${this.deviceData.deviceId}_${quality}_stream.m3u8`);
        
        // Clean up any existing stream file
        if (fs.existsSync(streamFile)) {
            fs.unlinkSync(streamFile);
        }

        // Get quality settings
        const qualitySettings = this.getQualitySettings(quality);
        
        // Start TUTK client process
        const tutkArgs = [
            '--uid', tutkid,
            '--password', password,
            '--authkey', authKey,
            '--output', streamFile,
            '--format', 'hls',
            '--video-codec', 'h264',
            '--audio-codec', 'aac',
            '--width', qualitySettings.width.toString(),
            '--height', qualitySettings.height.toString(),
            '--bitrate', qualitySettings.bitrate.toString(),
            '--fps', qualitySettings.fps.toString()
        ];

        this.console.log(`Starting TUTK client for ${tutkid} at ${quality} quality`);
        
        // Spawn TUTK client process
        const process = spawn('tutk-client', tutkArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Create connection pool entry
        const connection: ConnectionPool = {
            process,
            streamUrl: null,
            quality,
            lastUsed: Date.now(),
            isActive: false,
            reconnectAttempts: 0
        };

        // Handle process events
        process.on('error', (error) => {
            this.console.error(`TUTK client error for ${this.deviceData.name} at ${quality} quality: ${error.message}`);
            connection.isActive = false;
            this.handleConnectionError(quality);
        });

        process.on('exit', (code) => {
            if (code === 0) {
                this.console.log(`TUTK client exited successfully for ${this.deviceData.name} at ${quality} quality`);
            } else {
                this.console.error(`TUTK client exited with error code ${code} for ${this.deviceData.name} at ${quality} quality`);
            }
            connection.isActive = false;
            if (code !== 0) {
                this.handleConnectionError(quality);
            }
        });

        // Wait for stream file to be created
        let attempts = 0;
        const maxAttempts = 30; // 30 seconds timeout
        
        while (attempts < maxAttempts) {
            if (fs.existsSync(streamFile)) {
                connection.streamUrl = `file://${streamFile}`;
                connection.isActive = true;
                this.console.log(`TUTK stream started for ${quality}: ${connection.streamUrl}`);
                return connection;
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            attempts++;
        }

        throw new Error(`Timeout waiting for TUTK stream to start for ${quality}`);
    }

    getQualitySettings(quality: string): StreamQuality {
        const qualities: { [key: string]: StreamQuality } = {
            'LD': { id: 'LD', name: 'Low Definition', width: 640, height: 480, bitrate: 500000, fps: 15 },
            'SD': { id: 'SD', name: 'Standard Definition', width: 1280, height: 720, bitrate: 1000000, fps: 20 },
            'HD': { id: 'HD', name: 'High Definition', width: 1920, height: 1080, bitrate: 2000000, fps: 30 },
            '2K': { id: '2K', name: '2K Resolution', width: 2560, height: 1440, bitrate: 4000000, fps: 30 }
        };
        
        return qualities[quality] || qualities['HD'];
    }

    async handleStreamError(error: any, quality: string): Promise<void> {
        this.console.error(`Stream error for ${quality}: ${error.message}`);
        
        const connection = this.connectionPool.get(quality);
        if (connection) {
            connection.isActive = false;
            connection.reconnectAttempts++;
            
            if (connection.reconnectAttempts < this.maxReconnectAttempts) {
                this.console.log(`Attempting to reconnect ${quality} stream (attempt ${connection.reconnectAttempts})`);
                await this.reconnectWithBackoff(quality);
            } else {
                this.console.error(`Max reconnection attempts reached for ${quality} stream`);
                this.connectionPool.delete(quality);
            }
        }
    }

    async handleConnectionError(quality: string): Promise<void> {
        const connection = this.connectionPool.get(quality);
        if (connection) {
            connection.isActive = false;
            connection.reconnectAttempts++;
            
            if (connection.reconnectAttempts < this.maxReconnectAttempts) {
                this.console.log(`Connection error for ${quality}, attempting reconnection`);
                await this.reconnectWithBackoff(quality);
            } else {
                this.console.error(`Max reconnection attempts reached for ${quality}`);
                this.connectionPool.delete(quality);
            }
        }
    }

    async reconnectWithBackoff(quality: string): Promise<void> {
        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.lastReconnectTime), 30000); // Max 30 seconds
        this.lastReconnectTime++;
        
        this.console.log(`Reconnecting ${quality} stream in ${delay}ms`);
        
        setTimeout(async () => {
            try {
                const connection = await this.createTUTKConnection(quality);
                this.connectionPool.set(quality, connection);
                this.console.log(`Successfully reconnected ${quality} stream`);
                this.lastReconnectTime = 0; // Reset backoff on success
            } catch (error: any) {
                this.console.error(`Reconnection failed for ${quality}: ${error.message}`);
                await this.handleConnectionError(quality);
            }
        }, delay);
    }

    async stopStreaming(): Promise<void> {
        if (this.isStreaming) {
            this.console.log(`Stopping video stream for ${this.deviceData.name}`);
            
            // Close all connections in pool
            for (const [quality, connection] of this.connectionPool) {
                if (connection.process) {
                    connection.process.kill('SIGTERM');
                }
                
                if (connection.streamUrl) {
                    const streamFile = connection.streamUrl.replace('file://', '');
                    if (fs.existsSync(streamFile)) {
                        fs.unlinkSync(streamFile);
                    }
                }
            }
            
            this.connectionPool.clear();
            this.activeConnections = 0;
            this.isStreaming = false;
            this.lastReconnectTime = 0;
        }
    }

    async takePicture(): Promise<MediaObject> {
        try {
            this.console.log(`Taking snapshot from ${this.deviceData.name}`);
            
            // Ensure TUTK credentials are loaded
            if (!this.tutkCredentials) {
                await this.loadTUTKCredentials();
                if (!this.tutkCredentials) {
                    throw new Error('Failed to load TUTK credentials');
                }
            }

            // Try Python TUTK wrapper first
            try {
                const pythonSnapshot = await this.getPythonTUTKSnapshot();
                if (pythonSnapshot) {
                    this.console.log('Using Python TUTK snapshot');
                    return this.createMediaObject(pythonSnapshot, ScryptedMimeTypes.Image);
                }
            } catch (error: any) {
                this.console.log('Python TUTK snapshot failed, falling back to native implementation:', error.message);
            }

            // Fall back to native TUTK implementation
            const snapshotData = await this.takeTUTKSnapshot();
            
            return this.createMediaObject(snapshotData, ScryptedMimeTypes.Image);
            
        } catch (error: any) {
            this.console.error(`Error taking picture: ${error.message}`);
            throw error;
        }
    }

    async takeTUTKSnapshot(): Promise<Buffer> {
        if (!this.tutkCredentials) {
            throw new Error('TUTK credentials not available');
        }

        const { tutkid, password, authKey } = this.tutkCredentials;
        
        // Create a temporary file for the snapshot
        const tempDir = os.tmpdir();
        const snapshotFile = path.join(tempDir, `owlet_${this.deviceData.deviceId}_snapshot.jpg`);
        
        // Clean up any existing snapshot file
        if (fs.existsSync(snapshotFile)) {
            fs.unlinkSync(snapshotFile);
        }

        // TUTK snapshot arguments
        const tutkArgs = [
            '--uid', tutkid,
            '--password', password,
            '--authkey', authKey,
            '--snapshot', snapshotFile,
            '--format', 'jpeg',
            '--quality', '90'
        ];

        this.console.log(`Taking TUTK snapshot for ${tutkid}`);
        
        // Spawn TUTK snapshot process
        const snapshotProcess = spawn('tutk-snapshot', tutkArgs, {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        // Wait for snapshot to complete
        const snapshotPromise = new Promise<void>((resolve, reject) => {
            snapshotProcess.on('error', (error) => {
                reject(new Error(`TUTK snapshot error: ${error.message}`));
            });

            snapshotProcess.on('exit', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`TUTK snapshot failed with code ${code}`));
                }
            });

            // Timeout after 30 seconds
            setTimeout(() => {
                snapshotProcess.kill('SIGTERM');
                reject(new Error('TUTK snapshot timeout'));
            }, 30000);
        });

        await snapshotPromise;

        // Read the snapshot file
        if (!fs.existsSync(snapshotFile)) {
            throw new Error('Snapshot file was not created');
        }

        const snapshotData = fs.readFileSync(snapshotFile);
        
        // Clean up snapshot file
        fs.unlinkSync(snapshotFile);
        
        return snapshotData;
    }

    // Camera interface methods
    async getPictureOptions(): Promise<never[]> {
        return [];
    }

    // VideoCamera interface methods
    async getVideoStreamOptions(): Promise<never[]> {
        // Return empty array as per Scrypted SDK requirements
        // Stream quality is managed through settings instead
        return [];
    }

    // Device status methods
    async getDeviceStatus(): Promise<any> {
        return {
            deviceId: this.deviceData.deviceId,
            name: this.deviceData.name,
            status: this.deviceData.status,
            isStreaming: this.isStreaming,
            lastSeen: new Date().toISOString()
        };
    }

    // Settings interface methods
    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'deviceId',
                title: 'Device ID',
                description: 'Owlet device identifier',
                type: 'string',
                value: this.deviceData.deviceId,
                readonly: true
            },
            {
                key: 'status',
                title: 'Status',
                description: 'Current device status',
                type: 'string',
                value: this.deviceData.status,
                readonly: true
            },
            {
                key: 'serialNumber',
                title: 'Serial Number',
                description: 'Device serial number',
                type: 'string',
                value: this.deviceData.serialNumber || '',
                readonly: true
            },
            {
                key: 'firmwareVersion',
                title: 'Firmware Version',
                description: 'Device firmware version',
                type: 'string',
                value: this.deviceData.firmwareVersion || '',
                readonly: true
            },
            {
                key: 'tutkid',
                title: 'TUTK ID',
                description: 'TUTK device identifier',
                type: 'string',
                value: this.tutkCredentials?.tutkid || '',
                readonly: true
            },
            {
                key: 'streamQuality',
                title: 'Default Stream Quality',
                description: 'Default quality for video streams',
                type: 'string',
                value: this.currentQuality,
                choices: ['LD', 'SD', 'HD', '2K']
            },
            {
                key: 'motionDetection',
                title: 'Motion Detection',
                description: 'Enable motion detection notifications',
                type: 'boolean',
                value: this.motionDetection
            },
            {
                key: 'streamTimeout',
                title: 'Stream Timeout (seconds)',
                description: 'How long to keep streams active before timeout',
                type: 'number',
                value: this.streamTimeout,
                range: [60, 1800] // 1 minute to 30 minutes
            },
            {
                key: 'maxConnections',
                title: 'Max Concurrent Connections',
                description: 'Maximum number of concurrent streams',
                type: 'number',
                value: this.maxConnections,
                range: [1, 5]
            },
            {
                key: 'isStreaming',
                title: 'Streaming Status',
                description: 'Current streaming status',
                type: 'boolean',
                value: this.isStreaming,
                readonly: true
            },
            {
                key: 'activeConnections',
                title: 'Active Connections',
                description: 'Number of active stream connections',
                type: 'number',
                value: this.activeConnections,
                readonly: true
            }
        ];
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        switch (key) {
            case 'streamQuality':
                if (typeof value === 'string' && ['LD', 'SD', 'HD', '2K'].includes(value)) {
                    this.currentQuality = value;
                    this.console.log(`Stream quality set to ${value}`);
                }
                break;
                
            case 'motionDetection':
                if (typeof value === 'boolean') {
                    this.motionDetection = value;
                    this.console.log(`Motion detection ${value ? 'enabled' : 'disabled'}`);
                }
                break;
                
            case 'streamTimeout':
                if (typeof value === 'number' && value >= 60 && value <= 1800) {
                    this.streamTimeout = value;
                    this.console.log(`Stream timeout set to ${value} seconds`);
                }
                break;
                
            case 'maxConnections':
                if (typeof value === 'number' && value >= 1 && value <= 5) {
                    this.maxConnections = value;
                    this.console.log(`Max connections set to ${value}`);
                }
                break;
                
            default:
                this.console.log(`Setting ${key} = ${value} (read-only for camera devices)`);
                break;
        }
    }

    // Cleanup method for device removal
    async cleanup(): Promise<void> {
        this.console.log(`Cleaning up camera ${this.deviceData.name}`);
        await this.stopStreaming();
    }

    // Destructor to ensure proper cleanup
    async destroy(): Promise<void> {
        this.console.log(`Destroying camera ${this.deviceData.name}`);
        await this.cleanup();
    }

    // Python TUTK wrapper methods
    async getPythonTUTKStream(options?: RequestMediaStreamOptions): Promise<MediaObject | null> {
        try {
            if (!this.tutkCredentials) {
                return null;
            }

            const { tutkid, password, authKey } = this.tutkCredentials;
            const duration = 30; // Default duration for Python stream
            
            this.console.log('Attempting Python TUTK stream...');
            
            const result = await this.executePythonTUTK([
                '--id', tutkid,
                '--username', password,
                '--password', password,
                '--auth-key', authKey,
                '--duration', duration.toString()
            ]);

            if (result.success && result.video_data) {
                // Decode base64 video data
                const videoData = Buffer.from(result.video_data, 'base64');
                
                // Create temporary file for video stream
                const tempDir = os.tmpdir();
                const streamFile = path.join(tempDir, `owlet_python_${this.deviceData.deviceId}_stream.mp4`);
                
                // Write video data to file
                fs.writeFileSync(streamFile, videoData);
                
                this.console.log(`Python TUTK stream created: ${streamFile}`);
                
                return this.createMediaObject(`file://${streamFile}`, ScryptedMimeTypes.FFmpegInput);
            }
            
            return null;
            
        } catch (error: any) {
            this.console.error('Python TUTK stream failed:', error.message);
            return null;
        }
    }

    async getPythonTUTKSnapshot(): Promise<Buffer | null> {
        try {
            if (!this.tutkCredentials) {
                return null;
            }

            const { tutkid, password, authKey } = this.tutkCredentials;
            
            this.console.log('Attempting Python TUTK snapshot...');
            
            const result = await this.executePythonTUTK([
                '--id', tutkid,
                '--username', password,
                '--password', password,
                '--auth-key', authKey,
                '--snapshot'
            ]);

            if (result.success && result.image_data) {
                // Decode base64 image data
                const imageData = Buffer.from(result.image_data, 'base64');
                this.console.log(`Python TUTK snapshot captured: ${imageData.length} bytes`);
                return imageData;
            }
            
            return null;
            
        } catch (error: any) {
            this.console.error('Python TUTK snapshot failed:', error.message);
            return null;
        }
    }

    private async executePythonTUTK(args: string[]): Promise<any> {
        return new Promise((resolve, reject) => {
            const pythonScript = path.join(__dirname, '..', 'python', 'tutk-stream.py');
            const python = spawn('python3', [pythonScript, ...args]);
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                if (code === 0) {
                    try {
                        const result = JSON.parse(stdout);
                        resolve(result);
                    } catch (error) {
                        reject(new Error(`Failed to parse Python output: ${stdout}`));
                    }
                } else {
                    reject(new Error(`Python script exited with code ${code}: ${stderr}`));
                }
            });
            
            python.on('error', (error) => {
                reject(new Error(`Failed to start Python script: ${error.message}`));
            });
        });
    }

    // Connection timeout management
    startConnectionTimeout(): void {
        setInterval(() => {
            this.cleanupInactiveConnections();
        }, 60000); // Check every minute
    }

    cleanupInactiveConnections(): void {
        const now = Date.now();
        const timeoutMs = this.streamTimeout * 1000;
        
        for (const [quality, connection] of this.connectionPool) {
            if (connection.isActive && (now - connection.lastUsed) > timeoutMs) {
                this.console.log(`Cleaning up inactive connection for ${quality}`);
                
                if (connection.process) {
                    connection.process.kill('SIGTERM');
                }
                
                if (connection.streamUrl) {
                    const streamFile = connection.streamUrl.replace('file://', '');
                    if (fs.existsSync(streamFile)) {
                        fs.unlinkSync(streamFile);
                    }
                }
                
                this.connectionPool.delete(quality);
                this.activeConnections = Math.max(0, this.activeConnections - 1);
            }
        }
    }

    // Initialize connection timeout management
    private initializeConnectionManagement(): void {
        this.startConnectionTimeout();
    }
}
