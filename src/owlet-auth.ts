import axios from 'axios';

// Firebase Authentication Response
export interface FirebaseAuthResponse {
    kind: string;
    localId: string;
    email: string;
    displayName: string;
    idToken: string;
    registered: boolean;
    refreshToken: string;
    expiresIn: string;
}

// Owlet Device from API
export interface OwletDevice {
    id: string;
    name: string;
    type: string;
    deviceType?: string;
    status: string;
    serialNumber?: string;
    firmwareVersion?: string;
    lastSeen?: string;
    properties?: {
        [key: string]: any;
    };
}

// TUTK Credentials from KMS
export interface TUTKCredentials {
    password: string;
    tutkid: string;
    authKey: string;
}

// Legacy interfaces for backward compatibility
export interface OwletApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}

export interface OwletCameraConnectionInfo {
    uid: string;
    password: string;
    ipAddress: string;
    port: number;
    deviceId: string;
    status: string;
}

export class OwletAuth {
    private firebaseApiKey: string = 'AIzaSyCx17leGPCKu5tZ1BLPni5LbAAlVvnNxZQ';
    private firebaseUrl: string = 'https://www.googleapis.com/identitytoolkit/v3/relyingparty';
    private devicesUrl: string = 'https://devices-public.owletdata.com/v2';
    private kmsUrl: string = 'https://camera-kms.owletdata.com';
    
    private jwtToken: string | null = null;
    private firebaseRefreshToken: string | null = null;
    private tokenExpiry: number = 0;
    private accountId: string | null = null;

    constructor() {
        // No need for axios instance since we're using different endpoints
    }

    /**
     * Authenticate with Firebase and get JWT token
     */
    async login(email: string, password: string): Promise<string> {
        try {
            console.log(`Login attempt - Email: ${email}, Password length: ${password.length}, First char: '${password.charAt(0)}', Last char: '${password.charAt(password.length - 1)}'`);
            
            const requestData = {
                email,
                password,
                returnSecureToken: true
            };
            
            console.log('Firebase request data:', JSON.stringify({
                email: requestData.email,
                password: `[${requestData.password.length} chars]`,
                returnSecureToken: requestData.returnSecureToken
            }));
            
            const response = await axios.post<FirebaseAuthResponse>(
                `${this.firebaseUrl}/verifyPassword?key=${this.firebaseApiKey}`,
                requestData,
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const { idToken, refreshToken, expiresIn, localId } = response.data;
            
            this.jwtToken = idToken;
            this.firebaseRefreshToken = refreshToken;
            this.accountId = localId;
            this.tokenExpiry = Date.now() + (parseInt(expiresIn) * 1000);

            console.log('Successfully authenticated with Firebase');
            return idToken;

        } catch (error: any) {
            console.error('Firebase authentication failed:', error);
            
            // Handle specific Firebase authentication errors
            if (error.response?.data?.error) {
                const firebaseError = error.response.data.error;
                switch (firebaseError.code) {
                    case 'auth/user-not-found':
                        throw new Error('Invalid email address. Please check your Owlet account email.');
                    case 'auth/wrong-password':
                        throw new Error('Invalid password. Please check your Owlet account password.');
                    case 'auth/invalid-email':
                        throw new Error('Invalid email format. Please enter a valid email address.');
                    case 'auth/user-disabled':
                        throw new Error('This Owlet account has been disabled. Please contact Owlet support.');
                    case 'auth/too-many-requests':
                        throw new Error('Too many failed login attempts. Please try again later.');
                    default:
                        throw new Error(`Authentication failed: ${firebaseError.message}`);
                }
            }
            
            // Handle network errors
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Network error: Unable to connect to Owlet servers. Please check your internet connection.');
            }
            
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Connection timeout: Owlet servers are not responding. Please try again later.');
            }
            
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    /**
     * Refresh JWT token using Firebase refresh token
     */
    async refreshToken(jwt: string): Promise<string> {
        if (!this.firebaseRefreshToken) {
            throw new Error('No refresh token available');
        }

        try {
            const response = await axios.post<{
                id_token: string;
                refresh_token: string;
                expires_in: string;
            }>(
                `${this.firebaseUrl}/token?key=${this.firebaseApiKey}`,
                {
                    grant_type: 'refresh_token',
                    refresh_token: this.firebaseRefreshToken
                },
                {
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            const { id_token, refresh_token, expires_in } = response.data;
            
            this.jwtToken = id_token;
            this.firebaseRefreshToken = refresh_token;
            this.tokenExpiry = Date.now() + (parseInt(expires_in) * 1000);

            console.log('Successfully refreshed JWT token');
            return id_token;

        } catch (error: any) {
            console.error('Token refresh failed:', error);
            
            // Handle specific Firebase refresh errors
            if (error.response?.data?.error) {
                const firebaseError = error.response.data.error;
                switch (firebaseError.code) {
                    case 'auth/invalid-grant':
                        throw new Error('Refresh token expired. Please re-authenticate with your Owlet credentials.');
                    case 'auth/token-expired':
                        throw new Error('Authentication token expired. Please re-authenticate.');
                    default:
                        throw new Error(`Token refresh failed: ${firebaseError.message}`);
                }
            }
            
            // Handle network errors
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Network error: Unable to refresh authentication token. Please check your internet connection.');
            }
            
            throw new Error(`Token refresh failed: ${error.message}`);
        }
    }

    /**
     * Get list of devices from Owlet API
     */
    async getDevices(jwt: string, accountId: string): Promise<OwletDevice[]> {
        try {
            // Only try the main devices endpoint to avoid rate limiting
            const url = `${this.devicesUrl}/accounts/${accountId}/devices`;
            
            console.log('Trying endpoint:', url);
            const response = await axios.get(
                url,
                {
                    headers: {
                        'Authorization': `Bearer ${jwt}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            console.log(`Response from ${url}:`, JSON.stringify(response.data, null, 2));
            
            // Handle different response structures
            const responseData = response.data as any;
            const devices = responseData?.devices || responseData?.cameras || responseData || [];
            
            if (Array.isArray(devices)) {
                console.log(`Found ${devices.length} devices from ${url}`);
                
                // Log device types
                devices.forEach((device: any, index: number) => {
                    console.log(`Device ${index}: ID=${device.id}, Type=${device.type}, Name=${device.name}`);
                });
                
                // Filter for cameras
                const cameras = devices.filter((device: any) => 
                    device.type === 'camera' || 
                    device.deviceType === 'CAMERA' ||
                    device.id?.startsWith('OCA') ||
                    device.id?.includes('camera')
                );
                
                console.log(`Found ${cameras.length} cameras from ${url}`);
                console.log('Device types:', cameras.map(d => `${d.id}:${d.type}`));

                return cameras;
            }

            console.log('No devices found or invalid response format');
            return [];

        } catch (error: any) {
            console.error('Failed to get devices:', error);
            
            // Handle specific HTTP status codes
            if (error.response?.status === 401) {
                throw new Error('Authentication expired. Please check your Owlet credentials and try again.');
            }
            
            if (error.response?.status === 403) {
                throw new Error('Access denied. Your Owlet account may not have permission to access cameras.');
            }
            
            if (error.response?.status === 404) {
                throw new Error('Owlet API endpoint not found. The service may be temporarily unavailable.');
            }
            
            if (error.response?.status >= 500) {
                throw new Error('Owlet servers are experiencing issues. Please try again later.');
            }
            
            // Handle network errors
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Network error: Unable to connect to Owlet servers. Please check your internet connection.');
            }
            
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Connection timeout: Owlet servers are not responding. Please try again later.');
            }
            
            throw new Error(`Failed to get devices: ${error.message}`);
        }
    }


    /**
     * Get TUTK credentials for camera streaming
     */
    async getTUTKCredentials(jwt: string, deviceId: string): Promise<TUTKCredentials> {
        try {
            const response = await axios.get<TUTKCredentials>(
                `${this.kmsUrl}/kms/${deviceId}`,
                {
                    headers: {
                        'Authorization': jwt, // Note: NOT Bearer, just raw token
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                }
            );

            return response.data;

        } catch (error: any) {
            console.error(`Failed to get TUTK credentials for device ${deviceId}:`, error);
            
            // Handle specific HTTP status codes
            if (error.response?.status === 401) {
                throw new Error('Authentication expired. Please check your Owlet credentials and try again.');
            }
            
            if (error.response?.status === 403) {
                throw new Error('Access denied. Your Owlet account may not have permission to access this camera.');
            }
            
            if (error.response?.status === 404) {
                throw new Error(`Camera ${deviceId} not found. The camera may be offline or removed from your account.`);
            }
            
            if (error.response?.status >= 500) {
                throw new Error('Owlet servers are experiencing issues. Please try again later.');
            }
            
            // Handle network errors
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                throw new Error('Network error: Unable to connect to Owlet servers. Please check your internet connection.');
            }
            
            if (error.code === 'ETIMEDOUT') {
                throw new Error('Connection timeout: Owlet servers are not responding. Please try again later.');
            }
            
            throw new Error(`Failed to get TUTK credentials for camera ${deviceId}: ${error.message}`);
        }
    }

    /**
     * Legacy method for backward compatibility
     */
    async authenticate(username: string, password: string): Promise<void> {
        await this.login(username, password);
    }

    /**
     * Legacy method for backward compatibility
     */
    async getDevicesLegacy(): Promise<OwletDevice[]> {
        if (!this.jwtToken || !this.accountId) {
            throw new Error('Not authenticated');
        }
        return this.getDevices(this.jwtToken, this.accountId);
    }

    /**
     * Legacy method for backward compatibility
     */
    async getCameraConnectionInfo(deviceId: string): Promise<OwletCameraConnectionInfo | null> {
        if (!this.jwtToken) {
            throw new Error('Not authenticated');
        }

        try {
            const tutkCredentials = await this.getTUTKCredentials(this.jwtToken, deviceId);
            
            // Convert TUTK credentials to legacy format
            return {
                uid: tutkCredentials.tutkid,
                password: tutkCredentials.password,
                ipAddress: '', // Not available from KMS
                port: 0, // Not available from KMS
                deviceId,
                status: 'online'
            };
        } catch (error: any) {
            console.error(`Failed to get connection info for device ${deviceId}:`, error);
            return null;
        }
    }

    private isTokenValid(): boolean {
        if (!this.jwtToken) {
            return false;
        }
        
        // Check if token expires within the next 5 minutes
        const fiveMinutesFromNow = Date.now() + (5 * 60 * 1000);
        return Date.now() < this.tokenExpiry && this.tokenExpiry > fiveMinutesFromNow;
    }

    async ensureValidToken(): Promise<string> {
        if (!this.isTokenValid()) {
            console.log('JWT token expired or invalid, attempting refresh...');
            try {
                if (this.firebaseRefreshToken) {
                    return await this.refreshToken(this.jwtToken || '');
                } else {
                    throw new Error('No refresh token available');
                }
            } catch (error: any) {
                console.error('Token refresh failed:', error);
                throw new Error('Authentication expired. Please re-authenticate with your Owlet credentials.');
            }
        }
        
        return this.jwtToken!;
    }

    isAuthenticated(): boolean {
        return this.isTokenValid();
    }

    logout(): void {
        this.jwtToken = null;
        this.firebaseRefreshToken = null;
        this.tokenExpiry = 0;
        this.accountId = null;
    }

    // Getters for current state
    getCurrentJWT(): string | null {
        return this.jwtToken;
    }

    getAccountId(): string | null {
        return this.accountId;
    }
}
