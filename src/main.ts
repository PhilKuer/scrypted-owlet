import sdk, { ScryptedDeviceBase, DeviceProvider, Device, ScryptedDeviceType, ScryptedInterface, Setting, Settings, DeviceManager } from '@scrypted/sdk';
import { OwletCamera } from './owlet-camera';
import { OwletAuth } from './owlet-auth';

export default class OwletPlugin extends ScryptedDeviceBase implements DeviceProvider, Settings {
    devices = new Map<string, OwletCamera>();
    auth: OwletAuth;

    constructor() {
        super();
        this.auth = new OwletAuth();
        
        // Auto-discover devices on startup if credentials exist
        setTimeout(async () => {
            const email = this.storage.getItem('email');
            const password = this.storage.getItem('password');
            
            if (email && password) {
                this.console.log('Credentials found, running automatic discovery on startup...');
                try {
                    await this.auth.login(email, password);
                    await this.discoverDevices();
                    this.console.log('Automatic discovery completed successfully');
                } catch (error: any) {
                    this.console.error('Auto-discovery failed:', error.message);
                }
            } else {
                this.console.log('No credentials found, skipping automatic discovery');
            }
        }, 5000); // 5 second delay to let Scrypted fully initialize
        
        // Start periodic device discovery
        this.startDiscovery();
    }

    async getSettings(): Promise<Setting[]> {
        return [
            {
                key: 'email',
                title: 'Owlet Email',
                description: 'Your Owlet account email address',
                type: 'string',
                value: this.storage.getItem('email') || '',
            },
            {
                key: 'password',
                title: 'Owlet Password',
                description: 'Your Owlet account password',
                type: 'password',
                value: this.storage.getItem('password') || '',
            },
            {
                key: 'refreshInterval',
                title: 'Device Refresh Interval (minutes)',
                description: 'How often to refresh device list',
                type: 'number',
                value: parseInt(this.storage.getItem('refreshInterval') || '5'),
            },
            {
                key: 'manualCameraId',
                title: 'Manual Camera Device ID (optional)',
                description: 'If cameras are not auto-discovered, specify the camera device ID (e.g., OCA1234567890123)',
                type: 'string',
                value: this.storage.getItem('manualCameraId') || '',
            }
        ];
    }

    async putSetting(key: string, value: string | number | boolean): Promise<void> {
        // Handle password field specially to preserve special characters
        if (key === 'password') {
            const password = String(value);
            this.console.log(`Setting password - Length: ${password.length}, First char: '${password.charAt(0)}', Last char: '${password.charAt(password.length - 1)}'`);
            
            // Store password directly without .toString() to avoid encoding issues
            this.storage.setItem(key, password);
            
            // Verify the value was stored correctly
            const stored = this.storage.getItem('password');
            this.console.log(`Stored password length: ${stored?.length}, First char: '${stored?.charAt(0)}', Last char: '${stored?.charAt((stored?.length || 1) - 1)}'`);
            
            // Re-authenticate when password changes
            try {
                const email = this.storage.getItem('email') || '';
                const retrievedPassword = this.storage.getItem('password') || '';
                
                this.console.log(`Authentication attempt - Email length: ${email.length}, Password length: ${retrievedPassword.length}`);
                
                await this.auth.login(email, retrievedPassword);
                await this.discoverDevices();
            } catch (error) {
                this.console.error('Failed to authenticate with updated credentials:', error);
            }
        } else {
            // Handle other fields normally
            this.console.log(`Setting ${key} to:`, value);
            this.storage.setItem(key, value.toString());
            
            // Verify the value was stored correctly
            const storedValue = this.storage.getItem(key);
            this.console.log(`Stored ${key} value:`, storedValue);
            
            if (key === 'email') {
                // Re-authenticate when email changes
                try {
                    const email = this.storage.getItem('email') || '';
                    const password = this.storage.getItem('password') || '';
                    
                    this.console.log(`Authentication attempt - Email length: ${email.length}, Password length: ${password.length}`);
                    
                    await this.auth.login(email, password);
                    await this.discoverDevices();
                } catch (error) {
                    this.console.error('Failed to authenticate with updated credentials:', error);
                }
            } else if (key === 'manualCameraId') {
                // Re-discover devices when manual camera ID changes
                try {
                    this.console.log(`Manual camera ID updated to: ${value}`);
                    await this.discoverDevices();
                } catch (error) {
                    this.console.error('Failed to discover devices with updated camera ID:', error);
                }
            }
        }
    }

    async discoverDevices(duration?: number): Promise<Device[]> {
        try {
            this.console.log('Starting device discovery...');
            
            const email = this.storage.getItem('email');
            const password = this.storage.getItem('password');

            if (!email || !password) {
                this.console.log('Owlet credentials not configured - skipping device discovery');
                return [];
            }

            this.console.log(`Authenticating with Owlet API using email: ${email}`);

            // Authenticate with Owlet API using Firebase
            const jwt = await this.auth.login(email, password);
            const accountId = this.auth.getAccountId();
            
            if (!jwt || !accountId) {
                this.console.error('Failed to authenticate with Owlet API - no JWT token or account ID received');
                return [];
            }

            this.console.log(`Successfully authenticated with Owlet API (Account ID: ${accountId})`);

            // Get devices from Owlet API
            const devices = await this.auth.getDevices(jwt, accountId);
            
            this.console.log(`Discovered ${devices ? devices.length : 0} Owlet devices from API`);
            
            // Handle case where devices might be null or undefined
            if (!devices || !Array.isArray(devices)) {
                this.console.error('Invalid devices response:', devices);
                this.console.log('Devices is not an array, returning empty list');
                return [];
            }

            // Check if we found any cameras
            const cameras = devices.filter(device => 
                device.type === 'camera' || 
                device.deviceType === 'CAMERA' ||
                device.id?.startsWith('OCA')
            );

            this.console.log(`Found ${cameras.length} cameras from API`);

            // If no cameras found, try fallback methods
            if (cameras.length === 0) {
                this.console.log('No cameras found via API, trying fallback methods...');
                
                // Try hardcoded camera
                const hardcodedCameraId = 'OCA1234567890123';
                this.console.log(`Checking hardcoded camera: ${hardcodedCameraId}`);
                
                try {
                    const credentials = await this.auth.getTUTKCredentials(jwt, hardcodedCameraId);
                    if (credentials) {
                        this.console.log(`Found hardcoded camera ${hardcodedCameraId} with TUTK credentials`);
                        
                        const hardcodedCamera: any = {
                            id: hardcodedCameraId,
                            name: 'Owlet Camera',
                            type: 'camera',
                            deviceType: 'CAMERA',
                            status: 'online',
                            serialNumber: hardcodedCameraId,
                            firmwareVersion: 'unknown'
                        };
                        
                        devices.push(hardcodedCamera);
                        
                        // Store device data for later use
                        const deviceData = {
                            deviceId: hardcodedCameraId,
                            name: 'Owlet Camera',
                            tutkId: credentials.tutkid,
                            tutkUsername: credentials.password,
                            tutkPassword: credentials.password,
                            authKey: credentials.authKey,
                            status: 'online'
                        };
                        
                        this.storage.setItem(`device_${hardcodedCameraId}`, JSON.stringify(deviceData));
                        this.console.log(`Stored device data for ${hardcodedCameraId}`);
                    }
                } catch (error: any) {
                    this.console.log(`Hardcoded camera ${hardcodedCameraId} not found:`, error.message);
                }
                
                // Try manual camera ID from settings
                const manualCameraId = this.storage.getItem('manualCameraId');
                if (manualCameraId && manualCameraId.trim()) {
                    this.console.log(`Checking manual camera ID: ${manualCameraId}`);
                    try {
                        const credentials = await this.auth.getTUTKCredentials(jwt, manualCameraId);
                        if (credentials) {
                            this.console.log(`Found manual camera ${manualCameraId} with TUTK credentials`);
                            
                            const manualCamera: any = {
                                id: manualCameraId,
                                name: 'Manual Owlet Camera',
                                type: 'camera',
                                deviceType: 'CAMERA',
                                status: 'online',
                                serialNumber: manualCameraId,
                                firmwareVersion: 'unknown'
                            };
                            
                            devices.push(manualCamera);
                            
                            // Store device data for later use
                            const deviceData = {
                                deviceId: manualCameraId,
                                name: 'Manual Owlet Camera',
                                tutkId: credentials.tutkid,
                                tutkUsername: credentials.password,
                                tutkPassword: credentials.password,
                                authKey: credentials.authKey,
                                status: 'online'
                            };
                            
                            this.storage.setItem(`device_${manualCameraId}`, JSON.stringify(deviceData));
                            this.console.log(`Stored device data for ${manualCameraId}`);
                        }
                    } catch (error: any) {
                        this.console.log(`Manual camera ${manualCameraId} not found:`, error.message);
                    }
                }
            }

            const discoveredDevices: Device[] = [];
            let cameraCount = 0;

            // Return Device descriptors for Scrypted to create devices
            for (const deviceData of devices) {
                if (deviceData.type === 'camera') {
                    cameraCount++;
                    const nativeId = deviceData.id;
                    
                    // Create Device descriptor for Scrypted
                    const device: Device = {
                        nativeId: nativeId,
                        name: deviceData.name,
                        type: ScryptedDeviceType.Camera,
                        interfaces: [
                            ScryptedInterface.Camera,
                            ScryptedInterface.VideoCamera,
                            ScryptedInterface.Settings,
                            ScryptedInterface.Online
                        ]
                    };
                    
                    discoveredDevices.push(device);
                    this.console.log(`Discovered Owlet camera: ${deviceData.name} (${nativeId}) - Status: ${deviceData.status}`);
                }
            }

            this.console.log(`Processed ${cameraCount} camera devices`);
            this.console.log('Returning devices:', JSON.stringify(discoveredDevices, null, 2));
            
            // CRITICAL: Notify Scrypted that devices changed
            if (discoveredDevices.length > 0) {
                this.console.log('Notifying Scrypted of device changes...');
                await sdk.deviceManager.onDevicesChanged({
                    devices: discoveredDevices
                });
                this.console.log('Scrypted notified of device changes');
            }
            
            return discoveredDevices;

        } catch (error: any) {
            this.console.error('Error discovering Owlet devices:', error);
            
            // Handle specific error cases
            if (error.message.includes('Invalid email') || error.message.includes('Invalid password')) {
                this.console.error('Invalid Owlet credentials - please check your email and password');
            } else if (error.message.includes('Network error')) {
                this.console.error('Network error - please check your internet connection');
            } else if (error.message.includes('Too many failed login attempts')) {
                this.console.error('Too many failed login attempts - please wait before trying again');
            } else if (error.message.includes('Account disabled')) {
                this.console.error('Owlet account disabled - please contact Owlet support');
            }
            
            return [];
        }
    }

    async getDevice(nativeId: string): Promise<any> {
        this.console.log(`getDevice called for: ${nativeId}`);
        
        // Return existing instance if available
        if (this.devices.has(nativeId)) {
            this.console.log(`Returning existing camera instance for ${nativeId}`);
            return this.devices.get(nativeId);
        }
        
        // Load device data from storage
        const deviceDataStr = this.storage.getItem(`device_${nativeId}`);
        if (!deviceDataStr) {
            this.console.error(`No device data found for ${nativeId}`);
            return undefined;
        }
        
        try {
            const deviceData = JSON.parse(deviceDataStr);
            this.console.log(`Loaded device data for ${nativeId}:`, {
                deviceId: deviceData.deviceId,
                name: deviceData.name,
                tutkId: deviceData.tutkId,
                status: deviceData.status
            });
            
            // Create camera instance
            const camera = new OwletCamera(nativeId, deviceData, this.auth);
            this.devices.set(nativeId, camera);
            
            this.console.log(`Created OwletCamera instance for ${nativeId}: ${deviceData.name}`);
            return camera;
            
        } catch (error: any) {
            this.console.error(`Failed to parse device data for ${nativeId}:`, error.message);
            return undefined;
        }
    }

    async releaseDevice(id: string, nativeId: string): Promise<void> {
        const device = this.devices.get(nativeId);
        if (device) {
            await device.cleanup();
            this.devices.delete(nativeId);
        }
    }

    async getDevices(): Promise<Device[]> {
        // Return Device descriptors for all discovered cameras
        const devices: Device[] = [];
        
        // Get current device list from API to ensure we have the latest state
        try {
            const email = this.storage.getItem('email');
            const password = this.storage.getItem('password');
            
            if (email && password) {
                const jwt = await this.auth.login(email, password);
                const accountId = this.auth.getAccountId();
                
                if (jwt && accountId) {
                    const apiDevices = await this.auth.getDevices(jwt, accountId);
                    const cameras = apiDevices.filter(device => 
                        device.type === 'camera' || 
                        device.deviceType === 'CAMERA' ||
                        device.id?.startsWith('OCA')
                    );
                    
                    for (const deviceData of cameras) {
                        devices.push({
                            nativeId: deviceData.id,
                            name: deviceData.name,
                            type: ScryptedDeviceType.Camera,
                            interfaces: [
                                ScryptedInterface.Camera,
                                ScryptedInterface.VideoCamera,
                                ScryptedInterface.Settings,
                                ScryptedInterface.Online
                            ]
                        });
                    }
                }
            }
        } catch (error: any) {
            this.console.error('Failed to get current device list:', error.message);
        }
        
        return devices;
    }

    // Start periodic device discovery
    startDiscovery(): void {
        const interval = parseInt(this.storage.getItem('refreshInterval') || '5') * 60 * 1000;
        setInterval(() => {
            this.discoverDevices();
        }, interval);
    }

    // Handle device events (including settings changes)
    async onDeviceEvent(eventInterface: string, eventData: any): Promise<void> {
        if (eventInterface === ScryptedInterface.Settings) {
            this.console.log('Settings changed, checking for automatic discovery...');
            
            // Check if credentials now exist
            const email = this.storage.getItem('email');
            const password = this.storage.getItem('password');
            
            if (email && password) {
                this.console.log('Credentials found after settings change, running discovery...');
                try {
                    await this.auth.login(email, password);
                    await this.discoverDevices();
                    this.console.log('Settings-triggered discovery completed successfully');
                } catch (error: any) {
                    this.console.error('Settings-triggered discovery failed:', error.message);
                }
            }
        }
    }
}
